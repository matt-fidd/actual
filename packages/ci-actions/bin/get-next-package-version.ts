#!/usr/bin/env node

// This script is used in GitHub Actions to get the next version based on the current package.json version.
// It supports three types of versioning: nightly, hotfix, and monthly.
import fs from 'node:fs';
import { parseArgs } from 'node:util';

import {
  getNextVersion,
  isValidVersionType,
} from '../src/versions/get-next-package-version';

const options = {
  'package-json': {
    type: 'string',
    short: 'p',
    multiple: true,
  },
  type: {
    type: 'string', // nightly, hotfix, monthly, auto
    short: 't',
  },
  version: {
    type: 'string',
    short: 'v',
  },
  update: {
    type: 'boolean',
    short: 'u',
    default: false,
  },
} as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options,
  allowPositionals: true,
});

const packageJsonPaths = values['package-json'];
if (!packageJsonPaths || packageJsonPaths.length === 0) {
  fail(
    'Please specify the path to package.json using --package-json or -p option.',
  );
}

try {
  const firstPackageJson = JSON.parse(
    fs.readFileSync(packageJsonPaths[0], 'utf8'),
  );

  if (
    !('version' in firstPackageJson) ||
    typeof firstPackageJson.version !== 'string'
  ) {
    fail('The specified package.json does not contain a valid version field.');
  }

  const currentVersion = firstPackageJson.version;

  const explicitVersion = values.version;
  let newVersion;

  if (explicitVersion) {
    newVersion = explicitVersion;
  } else {
    const type = values.type;
    if (!type || !isValidVersionType(type)) {
      fail('Please specify the release type using --type or -t.');
    }

    try {
      newVersion = getNextVersion({
        currentVersion,
        type,
        currentDate: new Date(),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  process.stdout.write(newVersion);

  if (process.env.GITHUB_OUTPUT) {
    const resolvedType = newVersion.includes('-nightly.')
      ? 'nightly'
      : newVersion.split('.')[2] === '0'
        ? 'monthly'
        : 'hotfix';
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${newVersion}\ntype=${resolvedType}\n`,
    );
  }

  if (values.update) {
    for (const path of packageJsonPaths) {
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = newVersion;
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
  }
} catch (error) {
  fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
}
