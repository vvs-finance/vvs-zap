// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./libraries/Math.sol";
import "./interface/IVVSZap.sol";
import "@vvs-finance/vvs-swap-periphery/contracts/interfaces/IVVSRouter02.sol";

contract VVSZapEstimator is Ownable {
    using SafeERC20 for IERC20;

    IVVSZap public immutable zap;

    constructor(address _zap) {
        zap = IVVSZap(_zap);
    }

    /// @notice  estimating output amount of swap _inputAmount of _tokenIn to _tokenOut
    /// @param _tokenIn must be a pair in factory
    /// @param _tokenOut must be a pair in factory
    function estimateSwapAmountOut(
        address _tokenIn,
        address _tokenOut,
        uint256 _inputAmount
    ) external view returns (uint256) {
        require(zap.isToken(_tokenIn), "VVSZap:estimateSwapAmountOut: invalid _tokenIn Address");
        require(zap.isToken(_tokenOut), "VVSZap:estimateSwapAmountOut: invalid _tokenOut Address");
        require(
            zap.isLiquidityPoolExistInFactory(_tokenIn, _tokenOut),
            "VVSZap:estimateSwapAmountOut: no such LP pair"
        );
        return _estimateSwapAmountOut(_tokenIn, _tokenOut, _inputAmount);
    }

    /// @notice  estimating output amount of swap _inputAmount of _tokenIn to _tokenOut
    /// @param _fromToken must be a ERC20, input as address_zero as CRO will be consider as same amount of zap.WCRO()
    /// @param _toToken must be a ERC20, input as address_zero as CRO will be consider as same amount of zap.WCRO()
    /// @param _inputAmount must be > 0
    function estimateZapTokenToTokenAmountsOut(
        address _fromToken,
        address _toToken,
        uint256 _inputAmount
    ) external view returns (address[] memory, uint256[] memory) {
        address fromToken = _fromToken == address(0) ? zap.WCRO() : _fromToken;
        address toToken = _toToken == address(0) ? zap.WCRO() : _toToken;
        require(zap.isToken(fromToken), "VVSZap:estimateZapTokenToTokenAmountsOut: invalid fromToken Address");
        require(zap.isToken(toToken), "VVSZap:estimateZapTokenToTokenAmountsOut: invalid toToken Address");
        return _estimateZapTokenToTokenAmountsOut(fromToken, toToken, _inputAmount);
    }

    /// @notice  estimating routing path before stake as LP
    /// @param _fromToken must be a ERC20, input as address_zero as CRO will be consider as same amount of zap.WCRO()
    /// @param _inputAmount must be > 0
    /// @param _LP must be a pair, target LP
    /// @return swapPathBeforeLP and swapAmountsBeforeLP are the path and amounts from fromToken to intermediateToken(if available)
    /// @return amountForToken0 and amountForToken1 are the token amounts to stake in LP
    /// @dev amountForToken0 and amountForToken1 can be use to estimate zapIn & zapInToken outputAmount by calling estimateAddLiquidityOutputAmount
    function estimateZapInToLpSwapPaths(
        address _fromToken,
        uint256 _inputAmount,
        address _LP
    )
        external
        view
        returns (
            address[] memory,
            uint256[] memory,
            uint256,
            uint256
        )
    {
        address fromToken = _fromToken == address(0) ? zap.WCRO() : _fromToken;
        require(zap.isLP(_LP), "VVSZap:estimateZapInToLpSwapPaths: invalid _LP Address");
        address token0 = IVVSPair(_LP).token0();
        address token1 = IVVSPair(_LP).token1();
        if (_fromToken == token0 || _fromToken == token1) {
            address[] memory swapPathBeforeLP = new address[](2);
            swapPathBeforeLP[0] = _fromToken;
            uint256[] memory swapAmountsBeforeLP = new uint256[](2);
            uint256 halfInputAmountToSwap = _inputAmount - (_inputAmount / 2);
            swapAmountsBeforeLP[0] = halfInputAmountToSwap;
            if (_fromToken == token0) {
                swapPathBeforeLP[1] = token1;
                swapAmountsBeforeLP[1] = _estimateSwapAmountOut(_fromToken, token1, halfInputAmountToSwap);
                return (swapPathBeforeLP, swapAmountsBeforeLP, _inputAmount / 2, swapAmountsBeforeLP[1]);
            } else if (_fromToken == token1) {
                swapPathBeforeLP[1] = token0;
                swapAmountsBeforeLP[1] = _estimateSwapAmountOut(_fromToken, token0, halfInputAmountToSwap);
                return (swapPathBeforeLP, swapAmountsBeforeLP, swapAmountsBeforeLP[1], _inputAmount / 2);
            }
        } else {
            address intermediateToken = zap.getSuitableIntermediateTokenForTokenToLP(fromToken, _LP);
            (
                address[] memory swapPathBeforeLP,
                uint256[] memory swapAmountsBeforeLP
            ) = _estimateZapTokenToTokenAmountsOut(fromToken, intermediateToken, _inputAmount);
            {
                uint256 intermediateTokenAmount = swapAmountsBeforeLP.length > 0
                    ? swapAmountsBeforeLP[swapAmountsBeforeLP.length - 1]
                    : _inputAmount;
                uint256 amountForToken0;
                uint256 amountForToken1;
                if (intermediateToken == token0) {
                    amountForToken0 = intermediateTokenAmount / 2;
                    amountForToken1 = _estimateSwapAmountOut(
                        intermediateToken,
                        token1,
                        intermediateTokenAmount - amountForToken0
                    );
                } else if (intermediateToken == token1) {
                    amountForToken1 = intermediateTokenAmount / 2;
                    amountForToken0 = _estimateSwapAmountOut(
                        intermediateToken,
                        token0,
                        intermediateTokenAmount - amountForToken1
                    );
                } else {
                    amountForToken0 = _estimateSwapAmountOut(intermediateToken, token0, intermediateTokenAmount / 2);
                    amountForToken1 = _estimateSwapAmountOut(
                        intermediateToken,
                        token1,
                        intermediateTokenAmount - (intermediateTokenAmount / 2)
                    );
                }
                return (swapPathBeforeLP, swapAmountsBeforeLP, amountForToken0, amountForToken1);
            }
        }
    }

    /// @notice  estimating output amount of LP token when given token0 & token1
    /// @param _token0Amount token0's input amount of target LP
    /// @param _token1Amount token0's input amount of target LP
    /// @param _toLP target LP
    /// @dev amountForToken0 and amountForToken1 can be estimated by estimateZapInToLpSwapPaths
    function estimateAddLiquidityOutputAmount(
        uint256 _token0Amount,
        uint256 _token1Amount,
        address _toLP
    ) external view returns (uint256) {
        require(zap.isLP(_toLP), "VVSZap:estimateAddLiquidityOutputAmount: invalid _toLP Address");
        return _estimateAddLiquidityOutputAmount(_token0Amount, _token1Amount, _toLP);
    }

    /// @notice estimating outputAmount and path for zapOut LP to Token
    /// @param _fromLP input LP
    /// @param _toToken target token
    /// @return outputAmount = sum of swaping both token0 & token1 into target token
    function estimateZapOutToTokenOutputAmount(
        address _fromLP,
        uint256 _inputAmount,
        address _toToken
    )
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        uint256 outputAmount;
        require(zap.isLP(_fromLP), "VVSZap:estimateRemoveLiquidityOutputAmount: invalid _fromLP Address");
        (uint256 amount0, uint256 amount1) = _estimateRemoveLiquidityOutputAmount(_inputAmount, _fromLP);
        address _to = _toToken == address(0) ? zap.WCRO() : _toToken;
        {
            if (IVVSPair(_fromLP).token0() == _to) {
                outputAmount = amount0;
            } else {
                (, uint256[] memory swapAmountsForToken0) = _estimateZapTokenToTokenAmountsOut(
                    IVVSPair(_fromLP).token0(),
                    _to,
                    amount0
                );
                outputAmount = swapAmountsForToken0[swapAmountsForToken0.length - 1];
            }
        }
        {
            if (IVVSPair(_fromLP).token1() == _to) {
                outputAmount = outputAmount + amount1;
            } else {
                (, uint256[] memory swapAmountsForToken1) = _estimateZapTokenToTokenAmountsOut(
                    IVVSPair(_fromLP).token1(),
                    _to,
                    amount1
                );
                outputAmount = outputAmount + swapAmountsForToken1[swapAmountsForToken1.length - 1];
            }
        }
        return (amount0, amount1, outputAmount);
    }

    /// @notice estimating outputAmount when breaking LP
    /// @param _liquidityAmount input LP amount
    /// @param _toLP target LP
    /// @return token0 amount and token1 amount accordingly
    function estimateRemoveLiquidityOutputAmount(uint256 _liquidityAmount, address _toLP)
        external
        view
        returns (uint256, uint256)
    {
        require(zap.isLP(_toLP), "VVSZap:estimateRemoveLiquidityOutputAmount: invalid _toLP Address");
        return _estimateRemoveLiquidityOutputAmount(_liquidityAmount, _toLP);
    }

    /* ========== Private Estimation Functions ========== */

    function _estimateSwapAmountOut(
        address _tokenIn,
        address _tokenOut,
        uint256 _inputAmount
    ) private view returns (uint256) {
        (uint256 reserve0, uint256 reserve1, ) = IVVSPair(zap.getLiquidityPoolAddress(_tokenIn, _tokenOut))
            .getReserves();
        (address token0, ) = _tokenIn < _tokenOut ? (_tokenIn, _tokenOut) : (_tokenOut, _tokenIn);
        (uint256 reserveA, uint256 reserveB) = _tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        return IVVSRouter02(zap.ROUTER()).getAmountOut(_inputAmount, reserveA, reserveB);
    }

    function _estimateZapTokenToTokenAmountsOut(
        address _fromToken,
        address _toToken,
        uint256 _inputAmount
    ) private view returns (address[] memory, uint256[] memory) {
        address[] memory swapPath;
        uint256[] memory swapAmounts;
        if (_toToken != address(0) && _fromToken != _toToken) {
            swapPath = zap.getPathForTokenToToken(_fromToken, _toToken);
            swapAmounts = IVVSRouter02(zap.ROUTER()).getAmountsOut(_inputAmount, swapPath);
        } else {
            swapPath = new address[](0);
            swapAmounts = new uint256[](0);
        }
        return (swapPath, swapAmounts);
    }

    function _estimateAddLiquidityOutputAmount(
        uint256 _token0Amount,
        uint256 _token1Amount,
        address _toLP
    ) private view returns (uint256) {
        IVVSPair LP = IVVSPair(_toLP);
        (uint112 _reserve0, uint112 _reserve1, ) = LP.getReserves();
        uint256 amount0 = IERC20(LP.token0()).balanceOf(_toLP) + _token0Amount - _reserve0;
        uint256 amount1 = IERC20(LP.token1()).balanceOf(_toLP) + _token1Amount - _reserve1;
        uint256 liquidity;
        uint256 _totalSupply = LP.totalSupply();
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - LP.MINIMUM_LIQUIDITY();
        } else {
            liquidity = Math.min((amount0 * _totalSupply) / _reserve0, (amount1 * _totalSupply) / _reserve1);
        }
        return liquidity;
    }

    function _estimateRemoveLiquidityOutputAmount(uint256 _liquidityAmount, address _toLP)
        private
        view
        returns (uint256, uint256)
    {
        IVVSPair LP = IVVSPair(_toLP);
        uint256 _totalSupply = LP.totalSupply();
        uint256 amount0 = (_liquidityAmount * IERC20(LP.token0()).balanceOf(_toLP)) / _totalSupply;
        uint256 amount1 = (_liquidityAmount * IERC20(LP.token1()).balanceOf(_toLP)) / _totalSupply;
        return (amount0, amount1);
    }

    /* ========== RESTRICTED FUNCTIONS FOR MISDEPOSIT ========== */

    function withdrawBalance(address _token, uint256 _amount) public payable onlyOwner {
        if (_token == address(0)) {
            uint256 balance = address(this).balance;
            if (balance > 0) {
                if (_amount == 0) {
                    (bool sent, ) = payable(msg.sender).call{value: balance}("");
                    require(sent, "Failed to send Ether");
                } else {
                    (bool sent, ) = payable(msg.sender).call{value: _amount}("");
                    require(sent, "Failed to send Ether");
                }
            }
        } else {
            uint256 balance = IERC20(_token).balanceOf(address(this));

            if (_amount == 0) {
                _amount = balance;
            }
            IERC20(_token).transfer(owner(), _amount);
        }
    }
}
