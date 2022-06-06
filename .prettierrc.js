module.exports = {
  singleQuote: true,
  bracketSpacing: false,
  overrides: [
    {
      files: '*.sol',
      options: {
        printWidth: 120,
        tabWidth: 2,
        singleQuote: false,
        explicitTypes: 'always',
      },
    },
  ],
};
