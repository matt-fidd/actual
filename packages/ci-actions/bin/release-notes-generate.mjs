import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { inspect, promisify } from 'node:util';

import matter from 'gray-matter';
import listify from 'listify';

import {
  categoryAutocorrections,
  categoryOrder,
} from '../src/release-notes/util.mjs';

const exec = promisify(childProcess.exec);

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

const apiResult = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: /* GraphQL */ `
      query GetPRMetadata(
        $name: String!
        $owner: String!
        $headRefName: String!
      ) {
        repository(name: $name, owner: $owner) {
          pullRequests(headRefName: $headRefName, first: 1) {
            edges {
              node {
                number
                headRefName
              }
            }
          }
        }
      }
    `,
    variables: {
      name: repo,
      owner,
      headRefName: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
    },
  }),
}).then(res => res.json());

await collapsedLog('API Response', apiResult);

const prData = apiResult.data.repository.pullRequests.edges[0].node;

const version = prData.headRefName.split('/')[1].replace(/^v/, '');
const slug = version.replace(/\./g, '-');
const author = process.env.GITHUB_ACTOR || 'TODO';
const commitMessage = `Generate release notes for v${version}`;

await group('Prepare branch', async () => {
  if (process.env.GITHUB_HEAD_REF) {
    await exec(`git fetch origin ${process.env.GITHUB_HEAD_REF}`, {
      stdio: 'inherit',
    });
    await exec(`git checkout ${process.env.GITHUB_HEAD_REF}`, {
      stdio: 'inherit',
    });
  }

  // drop any previous generation commit to restore deleted source
  // files -- it may not be HEAD if cherry-picks landed after it
  const { stdout: commitHash } = await exec(
    `git log --grep='${commitMessage}' --format=%H -1`,
  );
  const hash = commitHash.trim();
  if (hash) {
    console.log(`Dropping previous release notes commit ${hash}`);
    await exec(`git rebase --onto ${hash}~1 ${hash}`, {
      stdio: 'inherit',
    });
  }
});

const { notesByCategory, files } = await parseReleaseNotes(
  'upcoming-release-notes',
);
const categorizedNotes = formatNotes(notesByCategory);

await collapsedLog('Release Notes', categorizedNotes);

if (files.length === 0) {
  console.log('No release notes found, nothing to generate');
  process.exit(0);
}

const highlights = '- TODO: Add release highlights';

await group('Generate blog post', async () => {
  const blogDir = 'packages/docs/blog';

  const existingFiles = (await fs.readdir(blogDir)).filter(f =>
    f.endsWith(`-release-${slug}.md`),
  );

  let blogPath;
  let existingDate;

  if (existingFiles.length > 0) {
    blogPath = join(blogDir, existingFiles[0]);
    const existing = await fs.readFile(blogPath, 'utf-8');
    const { data } = matter(existing);
    existingDate = typeof data.date === 'string' ? data.date : null;
    console.log(`Found existing blog post: ${blogPath}`);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `${today}-release-${slug}.md`;
    blogPath = join(blogDir, filename);
    existingDate = `${today}T10:00`;
  }

  const blogDate =
    existingDate || `${new Date().toISOString().slice(0, 10)}T10:00`;

  const blogContent = `---
title: Release ${version}
description: New release of Actual.
date: ${blogDate}
slug: release-${version}
tags: [announcement, release]
hide_table_of_contents: false
authors: ${author}
---

${highlights}

<!--truncate-->

**Docker Tag: v${version}**

${categorizedNotes}
`;

  await fs.writeFile(blogPath, blogContent);
  console.log(`Wrote ${blogPath}`);
});

await group('Update releases.md', async () => {
  const releasesPath = 'packages/docs/docs/releases.md';
  const existing = await fs.readFile(releasesPath, 'utf-8');

  const newSection = `## ${version}

Release date: TODO

${highlights}

**Docker Tag: v${version}**

${categorizedNotes}`;

  const sectionRegex = new RegExp(
    `## ${version.replace(/\./g, '\\.')}\\n[\\s\\S]*?(?=\\n## |$)`,
  );

  let updated;
  if (sectionRegex.test(existing)) {
    updated = existing.replace(sectionRegex, newSection);
    console.log(`Replaced existing section for ${version}`);
  } else {
    updated = existing.replace(
      '# Release Notes\n',
      `# Release Notes\n\n${newSection}\n`,
    );
    console.log(`Added new section for ${version}`);
  }

  await fs.writeFile(releasesPath, updated);
  console.log(`Updated ${releasesPath}`);
});

await group('Remove used release notes', async () => {
  await Promise.all(
    files.map(f => fs.unlink(join('upcoming-release-notes', f))),
  );
});

await group('Commit and push', async () => {
  await exec(
    'git add upcoming-release-notes packages/docs/blog packages/docs/docs/releases.md',
    { stdio: 'inherit' },
  );
  const name = 'github-actions[bot]';
  const email = '41898282+github-actions[bot]@users.noreply.github.com';
  await exec(`git commit -m '${commitMessage}'`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_COMMITTER_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_EMAIL: email,
    },
  });
  await exec('git push --force-with-lease origin', { stdio: 'inherit' });
});

async function parseReleaseNotes(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.match(/^\d+\.md$/));
  const notes = files.map(async name => {
    const content = await fs.readFile(join(dir, name), 'utf-8');
    const { data, content: body } = matter(content);
    const number = name.replace('.md', '');
    const authors = listify(
      data.authors.map(a => `@${a}`),
      { finalWord: '&' },
    );
    return {
      category: categoryAutocorrections[data.category] ?? data.category,
      value: `- [#${number}](https://github.com/actualbudget/${repo}/pull/${number}) ${body.trim()} — thanks ${authors}`,
    };
  });

  const notesByCategory = (await Promise.all(notes)).reduce(
    (acc, note) => {
      if (!acc[note.category]) {
        console.log(`WARNING: Unrecognized category "${note.category}"`);
        acc[note.category] = [];
      }
      acc[note.category].push(note.value);
      return acc;
    },
    Object.fromEntries(categoryOrder.map(c => [c, []])),
  );

  return { notesByCategory, files };
}

function formatNotes(notes) {
  return Object.entries(notes)
    .filter(([_, values]) => values.length > 0)
    .map(([category, values]) => `#### ${category}\n\n${values.join('\n')}`)
    .join('\n\n');
}

async function collapsedLog(name, value) {
  await group(name, () => {
    if (typeof value === 'string') {
      console.log(value);
    } else {
      console.log(inspect(value, { depth: null }));
    }
  });
}

async function group(name, cb) {
  console.log(`::group::${name}`);
  await cb();
  console.log('::endgroup::');
}
