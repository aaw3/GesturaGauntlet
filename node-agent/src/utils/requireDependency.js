function requireDependency(name) {
  try {
    return require(name);
  } catch {
    try {
      return require(`../../../gestura-backend/node_modules/${name}`);
    } catch {
      return require(`../../../Dashboard/node_modules/${name}`);
    }
  }
}

module.exports = { requireDependency };
