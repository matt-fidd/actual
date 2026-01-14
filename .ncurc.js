module.exports = {
  workspaces: true,
  cooldown: 10,
  target: 'semver',
  reject: [
    'react-spring',
    'inter-ui',
    '*electron*',
    'openid-client',
    'google-protobuf',
  ],
  filterResults: (name, { upgradedVersionSemver }) => {
    if (name === '@types/node') {
      const major = parseInt(upgradedVersionSemver?.major, 10);
      return !Number.isInteger(major) || major <= 22;
    }
    return true;
  },
};
