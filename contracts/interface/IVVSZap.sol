// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@vvs-finance/vvs-swap-core/contracts/interfaces/IVVSPair.sol";
import "@vvs-finance/vvs-swap-core/contracts/interfaces/IVVSFactory.sol";
import "@vvs-finance/vvs-swap-periphery/contracts/interfaces/IVVSRouter02.sol";
import "@vvs-finance/vvs-swap-periphery/contracts/interfaces/IWCRO.sol";

interface IVVSZap {
    /* ========== CONSTANT VARIABLES ========== */

    function WCRO() external view returns (address);

    function ROUTER() external view returns (address);

    function FACTORY() external view returns (address);

    function lastFetchedPairIndex() external view returns (uint256);

    /* ========== STATE VARIABLES ========== */
    function liquidityPools(address _address) external view returns (bool);

    function tokens(address _address) external view returns (uint256);

    function tokenList(uint256 _index) external view returns (address);

    function intermediateTokens(address _address) external view returns (uint256);

    function intermediateTokenList(uint256 _index) external view returns (address);

    function presetPaths(address _fromAddress, address _toAddress) external view returns (address[] memory);

    /* ========== EVENT ========== */
    event ZapIn(address indexed to, uint256 amount, uint256 outputAmount);
    event ZapInToken(address indexed from, address indexed to, uint256 amount, uint256 outputAmount);
    event ZapOut(address indexed from, address indexed to, uint256 amount, uint256 outputAmount);
    event SwapExactTokensForTokens(address[] paths, uint256[] amounts);
    event FetchLiquidityPoolsFromFactory(uint256 startFromPairIndex, uint256 endAtPairIndex);

    event AddLiquidityPool(address indexed liquidityPool, bool isFromFactory);
    event AddToken(address indexed token, bool isFromFactory);
    event AddIntermediateToken(address indexed intermediateToken);

    event RemoveLiquidityPool(address indexed liquidityPool);
    event RemoveToken(address indexed token);
    event RemoveIntermediateToken(address indexed intermediateToken);

    event SetPresetPath(address indexed fromToken, address indexed toToken, address[] paths, bool isAutoGenerated);
    event RemovePresetPath(address indexed fromToken, address indexed toToken);

    function zapInToken(
        address _fromToken,
        uint256 _inputAmount,
        address _toTokenOrLp,
        uint256 _outputAmountMin
    ) external returns (uint256);

    function zapIn(address _toTokenOrLp, uint256 _outputAmountMin) external payable returns (uint256);

    function zapOut(
        address _fromLp,
        uint256 _inputAmount,
        address _toTokenOrLp,
        uint256 _outputAmountMin
    ) external payable returns (uint256);

    function getLiquidityPoolAddress(address _tokenA, address _tokenB) external view returns (address);

    function isLiquidityPoolExistInFactory(address _tokenA, address _tokenB) external view returns (bool);

    function isLP(address _address) external view returns (bool);

    function isToken(address _address) external view returns (bool);

    function getToken(uint256 i) external view returns (address);

    function getTokenListLength() external view returns (uint256);

    function getIntermediateToken(uint256 _i) external view returns (address);

    function getIntermediateTokenListLength() external view returns (uint256);

    function getPresetPath(address _tokenA, address _tokenB) external view returns (address[] memory);

    function getPathForTokenToToken(address _fromToken, address _toToken) external view returns (address[] memory);

    function getAutoCalculatedPathWithIntermediateTokenForTokenToToken(address _fromToken, address _toToken)
        external
        view
        returns (address[] memory);

    function getSuitableIntermediateTokenForTokenToLP(address _fromToken, address _toLP)
        external
        view
        returns (address);

    /* ========== Update Functions ========== */
    function fetchLiquidityPoolsFromFactory() external;

    function fetchLiquidityPoolsFromFactoryWithIndex(uint256 _startFromPairIndex, uint256 _interval) external;

    /* ========== RESTRICTED FUNCTIONS ========== */
    function addToken(address _tokenAddress) external;

    function removeToken(address _tokenAddress) external;

    function addIntermediateToken(address _tokenAddress) external;

    function removeIntermediateToken(address _intermediateTokenAddress) external;

    function setPresetPath(
        address _tokenA,
        address _tokenB,
        address[] memory _path
    ) external;

    function setPresetPathByAutoCalculation(address _tokenA, address _tokenB) external;

    function removePresetPath(address tokenA, address tokenB) external;

    function addLiquidityPool(address _lpAddress) external;

    function removeLiquidityPool(address _lpAddress) external;

    function withdrawBalance(address _token, uint256 _amount) external payable;
}
