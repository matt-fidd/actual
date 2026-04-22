#!/usr/bin/env node

import process from 'node:process';

import { Octokit } from '@octokit/rest';

const LABEL = 'needs info';
const cutoff = 7 * 24 * 60 * 60 * 1000;
const now = Date.now();

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
if (!owner || !repo) {
  throw new Error('GITHUB_REPOSITORY must be set to "owner/repo"');
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const closeIssue = async (number: number) => {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: number,
    body: 'This issue has been automatically closed because there have been no comments for 7 days after the "needs info" label was added. If you still need help, please feel free to reopen the issue with the requested information.',
  });
  await octokit.issues.update({
    owner,
    repo,
    issue_number: number,
    state: 'closed',
  });
};

const issues = await octokit.paginate(octokit.issues.listForRepo, {
  owner,
  repo,
  state: 'open',
  labels: LABEL,
  per_page: 100,
});

for (const issue of issues) {
  if (issue.pull_request) continue;

  if (now - new Date(issue.updated_at).getTime() >= cutoff) {
    await closeIssue(issue.number);
    continue;
  }

  const events = await octokit.paginate(octokit.issues.listEventsForTimeline, {
    owner,
    repo,
    issue_number: issue.number,
    per_page: 100,
  });

  const labelings = events.filter(
    e => e.event === 'labeled' && 'label' in e && e.label?.name === LABEL,
  );
  if (labelings.length === 0) continue;
  const labelAddedAt = new Date(
    (labelings[labelings.length - 1] as { created_at: string }).created_at,
  ).getTime();

  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: issue.number,
    per_page: 100,
  });
  const lastCommentAt = comments.length
    ? new Date(comments[comments.length - 1].created_at).getTime()
    : 0;

  const effective = Math.max(labelAddedAt, lastCommentAt);
  if (now - effective < cutoff) continue;

  await closeIssue(issue.number);
}
