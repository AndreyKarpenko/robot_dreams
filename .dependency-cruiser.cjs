module.exports = {
  forbidden: ['orders', 'products', 'users'].map((name) => ({
    name: `${name}-module-boundary`,
    severity: 'error',
    from: { path: `(^|/)${name}/` },
    to: {
      path: `(^|/)(${['orders', 'products', 'users'].filter((n) => n !== name).join('|')})/`,
      pathNot: '/index\\.ts$',
    },
  })),
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
