#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { exit } = require('node:process');

// Try to require ncu - will check local node_modules first, then try global
let ncu;
try {
  ncu = require('npm-check-updates');
} catch {
  // If local require fails, try global installation
  try {
    const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const globalNcuPath = require('node:path').join(
      globalPath,
      'npm-check-updates',
    );
    ncu = require(globalNcuPath);
  } catch {
    console.error(
      'Error: npm-check-updates is not installed.\n',
      'Please install it globally with: npm install -g npm-check-updates\n',
      'Or as a dev dependency: yarn add -D npm-check-updates',
    );
    exit(1);
  }
}

// Get the full path to yarn
function getYarnPath() {
  try {
    // Try to find yarn in the PATH using 'which' (Unix) or 'where' (Windows)
    const command = process.platform === 'win32' ? 'where yarn' : 'which yarn';
    const yarnPath = execSync(command, { encoding: 'utf-8', stdio: 'pipe' })
      .trim()
      .split('\n')[0];
    if (yarnPath && existsSync(yarnPath)) {
      return yarnPath;
    }
  } catch {
    // which/where failed, continue to fallback
  }

  // Fallback: try to use yarn directly (will work if in PATH)
  try {
    execSync('yarn --version', { encoding: 'utf-8', stdio: 'pipe' });
    return 'yarn';
  } catch {
    // If that fails, return 'yarn' anyway - the error will be clearer
    return 'yarn';
  }
}

// Initialize yarn path at startup
const YARN_PATH = getYarnPath();

function execAsync(command, cwd) {
  try {
    // Replace 'yarn' with full path if it's a yarn command
    const finalCommand = command.startsWith('yarn ')
      ? command.replace(/^yarn /, `${YARN_PATH} `)
      : command;

    return execSync(finalCommand, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch (error) {
    // Include the actual error output (stderr and stdout) in the error message
    let errorOutput = '';
    if (error.stderr) {
      errorOutput += `\nSTDERR:\n${error.stderr}`;
    }
    if (error.stdout) {
      errorOutput += `\nSTDOUT:\n${error.stdout}`;
    }
    if (!errorOutput && error.message) {
      errorOutput = `\n${error.message}`;
    }
    const fullError = `Command failed: ${command}${errorOutput}`;
    throw new Error(fullError);
  }
}

function getPackageJsonPath(workspacePath) {
  return workspacePath === '.'
    ? 'package.json'
    : `${workspacePath}/package.json`;
}

async function getAllUpdates() {
  console.log('Checking for updates across all workspaces...');

  try {
    // Load user config from .ncurc.js (in project root)
    let userCfg = {};
    const configPath = '.ncurc.js';
    if (existsSync(configPath)) {
      // Use absolute path to avoid module resolution issues
      userCfg = require(resolve(process.cwd(), configPath));
    }

    // Use ncu package directly with workspace support
    const upgraded = await ncu.run({
      ...userCfg,
      jsonUpgraded: true,
      loglevel: 'silent',
    });

    // ncu returns: { "workspace/package.json": { "package": "version" } }
    // We need to flatten this into our format
    const allUpdates = [];

    for (const [packageJsonPath, updates] of Object.entries(upgraded)) {
      if (
        !updates ||
        typeof updates !== 'object' ||
        Object.keys(updates).length === 0
      ) {
        continue;
      }

      // Extract workspace path from package.json path
      // e.g., "packages/loot-core/package.json" -> "packages/loot-core"
      // or "package.json" -> "."
      const workspacePath =
        packageJsonPath === 'package.json'
          ? '.'
          : packageJsonPath.replace(/\/package\.json$/, '');

      if (!existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };

      for (const [packageName, newVersion] of Object.entries(updates)) {
        const currentVersion = allDeps[packageName];
        if (currentVersion) {
          // Normalize versions by removing range prefixes for comparison
          const currentVersionClean = currentVersion.replace(/^[\^~]/, '');
          const newVersionClean = String(newVersion).replace(/^[\^~]/, '');

          // Only add if versions are actually different
          if (currentVersionClean !== newVersionClean) {
            allUpdates.push({
              packageName,
              currentVersion,
              newVersion: String(newVersion),
              workspacePath,
            });
          }
        }
      }
    }

    return allUpdates;
  } catch (error) {
    console.warn(`Warning: Failed to get updates: ${error}`);
    return [];
  }
}

function groupUpdatesByPackage(updates) {
  const grouped = new Map();

  for (const update of updates) {
    if (!grouped.has(update.packageName)) {
      grouped.set(update.packageName, []);
    }
    grouped.get(update.packageName).push(update);
  }

  return Array.from(grouped.entries()).map(([packageName, updates]) => ({
    packageName,
    updates,
  }));
}

function updatePackageInWorkspace(packageName, newVersion, workspacePath) {
  const packageJsonPath = getPackageJsonPath(workspacePath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  let updated = false;

  // Helper to preserve version range prefix
  const preserveRangePrefix = (oldVersion, newVersion) => {
    // Get prefix from old version (^ or ~)
    const prefix = oldVersion.match(/^[\^~]/)?.[0] || '';
    // Strip any existing prefix from newVersion to avoid double prefixes (^^)
    const cleanNewVersion = String(newVersion).replace(/^[\^~]/, '');
    return prefix + cleanNewVersion;
  };

  if (packageJson.dependencies?.[packageName]) {
    packageJson.dependencies[packageName] = preserveRangePrefix(
      packageJson.dependencies[packageName],
      newVersion,
    );
    updated = true;
  }
  if (packageJson.devDependencies?.[packageName]) {
    packageJson.devDependencies[packageName] = preserveRangePrefix(
      packageJson.devDependencies[packageName],
      newVersion,
    );
    updated = true;
  }
  if (packageJson.peerDependencies?.[packageName]) {
    packageJson.peerDependencies[packageName] = preserveRangePrefix(
      packageJson.peerDependencies[packageName],
      newVersion,
    );
    updated = true;
  }

  if (updated) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf-8',
    );
  }
}

function applyUpdate(groupedUpdate) {
  console.log(
    `\n📦 Updating ${groupedUpdate.packageName} in ${groupedUpdate.updates.length} workspace(s)...`,
  );

  for (const update of groupedUpdate.updates) {
    console.log(
      `  ${update.workspacePath}: ${update.currentVersion} → ${update.newVersion}`,
    );
    updatePackageInWorkspace(
      update.packageName,
      update.newVersion,
      update.workspacePath,
    );
  }
}

function commitUpdate(groupedUpdate) {
  const versionRange = `${groupedUpdate.updates[0].currentVersion} → ${groupedUpdate.updates[0].newVersion}`;
  const commitMessage = `${groupedUpdate.packageName} (${versionRange})`;

  try {
    execAsync(`git add -A`);
    execAsync(`git commit -m "${commitMessage}"`);
    console.log(`✅ Committed: ${commitMessage}`);
    return true;
  } catch (error) {
    throw new Error(`Failed to commit: ${error}`);
  }
}

function rollbackUpdate() {
  try {
    // Reset the last commit but keep changes staged
    execAsync('git reset --soft HEAD~1');
    // Discard all changes (package.json and yarn.lock)
    execAsync('git reset --hard HEAD');
    console.log('  ↻ Rolled back changes');
    return true;
  } catch (error) {
    console.error(`  ⚠️  Warning: Failed to rollback: ${error.message}`);
    return false;
  }
}

function runYarnInstall() {
  console.log('  Running yarn install...');
  execAsync('yarn install', undefined);
  console.log('  ✅ yarn install passed');
}

function verifyUpdate() {
  console.log('\n🔍 Verifying update...');

  try {
    console.log('  Running yarn lint:fix...');
    execAsync('yarn lint:fix', undefined);
    console.log('  ✅ yarn lint:fix passed');

    console.log('  Running yarn typecheck...');
    execAsync('yarn typecheck', undefined);
    console.log('  ✅ yarn typecheck passed');

    console.log('  Running yarn test (excluding eslint-plugin-actual)...');
    // Use lage to run tests, scoping to all packages except eslint-plugin-actual
    // Get list of all workspace names and filter out eslint-plugin-actual
    const allWorkspaces = execAsync('yarn workspaces list --json', undefined)
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(entry => entry && entry.name !== 'actual'); // Exclude root

    // Get all package names except eslint-plugin-actual
    const scopedPackages = allWorkspaces
      .filter(entry => entry.name !== 'eslint-plugin-actual')
      .map(entry => entry.name);

    // Use lage with scope to run tests for all packages except eslint-plugin-actual
    // If there are packages to test, run lage with scope
    if (scopedPackages.length > 0) {
      execAsync(
        `yarn lage test --scope ${scopedPackages.join(' ')}`,
        undefined,
      );
    }
    console.log('  ✅ yarn test passed');

    return true;
  } catch (error) {
    console.error('\n❌ Verification failed!');
    console.error('\nError details:');
    console.error(error.message || error);
    if (error.stack && !error.message.includes(error.stack)) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    return false;
  }
}

function checkGitStatus() {
  try {
    const status = execAsync('git status --porcelain');
    if (status) {
      console.error(
        'Error: Working directory is not clean. Please commit or stash your changes first.',
      );
      exit(1);
    }
  } catch {
    // Git might not be initialized, that's okay
  }
}

async function main() {
  console.log('🚀 Dependency Upgrade Script\n');

  checkGitStatus();

  // Get all updates
  const allUpdates = await getAllUpdates();

  if (allUpdates.length === 0) {
    console.log('✅ No updates available!');
    exit(0);
  }

  // Group by package name
  const groupedUpdates = groupUpdatesByPackage(allUpdates);

  console.log(
    `\nFound ${groupedUpdates.length} package(s) with updates across ${allUpdates.length} workspace(s).\n`,
  );

  const failedUpgrades = [];

  // Process each update
  for (let i = 0; i < groupedUpdates.length; i++) {
    const groupedUpdate = groupedUpdates[i];
    const progress = `[${i + 1}/${groupedUpdates.length}]`;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${progress} Processing: ${groupedUpdate.packageName}`);
    console.log('='.repeat(60));

    try {
      // Apply the update
      applyUpdate(groupedUpdate);

      // Run yarn install to update yarn.lock before committing
      console.log('\n📦 Updating yarn.lock...');
      runYarnInstall();

      // Commit the change (includes package.json and yarn.lock)
      commitUpdate(groupedUpdate);

      // Verify
      const verified = verifyUpdate();

      if (!verified) {
        console.log(
          `\n⚠️  Verification failed for ${groupedUpdate.packageName}.`,
        );
        console.log('Rolling back changes...');

        // Rollback the commit and changes
        rollbackUpdate();

        // Track the failed upgrade
        failedUpgrades.push({
          packageName: groupedUpdate.packageName,
          updates: groupedUpdate.updates,
          reason: 'Verification failed (lint:fix or typecheck)',
        });

        console.log(
          `\n❌ Skipped ${groupedUpdate.packageName} - will be reported at the end`,
        );
        continue; // Continue to next upgrade
      }

      console.log(`\n✅ Successfully upgraded ${groupedUpdate.packageName}`);
    } catch (error) {
      console.error(
        `\n❌ Error processing ${groupedUpdate.packageName}:`,
        error,
      );

      // Try to rollback if we got past the commit
      try {
        rollbackUpdate();
      } catch {
        // Ignore rollback errors
      }

      // Track the failed upgrade
      failedUpgrades.push({
        packageName: groupedUpdate.packageName,
        updates: groupedUpdate.updates,
        reason: `Error: ${error.message || error}`,
      });

      console.log(
        `\n❌ Skipped ${groupedUpdate.packageName} - will be reported at the end`,
      );
      continue; // Continue to next upgrade
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));

  if (failedUpgrades.length === 0) {
    console.log('🎉 All dependencies upgraded successfully!');
  } else {
    const successCount = groupedUpdates.length - failedUpgrades.length;
    console.log(`✅ Successfully upgraded ${successCount} package(s)`);
    console.log(`❌ Failed to upgrade ${failedUpgrades.length} package(s):\n`);

    for (const failed of failedUpgrades) {
      console.log(`  • ${failed.packageName}`);
      for (const update of failed.updates) {
        console.log(
          `    - ${update.workspacePath}: ${update.currentVersion} → ${update.newVersion}`,
        );
      }
      console.log(`    Reason: ${failed.reason}\n`);
    }

    console.log(
      'These packages were rolled back and can be upgraded manually if needed.',
    );
  }

  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
  exit(1);
});
