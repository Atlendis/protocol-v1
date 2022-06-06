module.exports = {
  skipFiles: [
    'mock/AaveLendingPoolMock.sol',
    'mock/EIP173Proxy.sol',
    'mock/FlashLoanAttacker.sol',
    'mock/Proxy.sol',
    'mock/SafeMath.sol',
    'mock/Token.sol',
    'mock/WadRayMathMock.sol',
    'lib/WadRayMath.sol',
  ],
  configureYulOptimizer: true,
};
