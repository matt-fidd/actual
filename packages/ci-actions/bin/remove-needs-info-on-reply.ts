#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { Octokit } from '@octokit/rest';
import type { IssueCommentEvent } from '@octokit/webhooks-types';

const LABEL = 'needs info';

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
if (!owner || !repo) {
  throw new Error('GITHUB_REPOSITORY must be set to "owner/repo"');
}

const event: IssueCommentEvent = JSON.parse(
  await readFile(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
);

if (
  event.action !== 'created' ||
  event.issue.pull_request ||
  event.issue.state !== 'open' ||
  event.issue.user.login !== event.comment.user.login ||
  !event.issue.labels?.some(l => l.name === LABEL)
) {
  process.exit(0);
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
try {
  await octokit.issues.removeLabel({
    owner,
    repo,
    issue_number: event.issue.number,
    name: LABEL,
  });
} catch (err) {
  // Another run may have removed the label in the meantime; anything else
  // should still surface.
  if (
    !(err && typeof err === 'object' && 'status' in err && err.status === 404)
  ) {
    throw err;
  }
}
