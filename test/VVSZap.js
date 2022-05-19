const { expectRevert } = require("@openzeppelin/test-helpers");
const { assert, expect } = require("chai");
const BigNumber = require("bignumber.js");
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 0 });
const MockERC20 = artifacts.require("MockERC20");
const {
  checkGasUsed,
  SKIP_EVENT_PARAM_CHECK,
  expectEvent,
  getMockExternalContract,
  getTransactionFee,
} = require("./test-util");
const { constants } = require("ethers");
const { AddressZero } = require("@ethersproject/constants");
const { MaxUint256 } = constants;
contract("VVSZap", () => {
  const allowableSlippagePercent = 5;
  const maxGasUsed = 1000000;
  const isDebugMode = false;
  let numberOfOriginalLP;
  let vvsFactory;
  let vvsRouter;
  let vvsZap;
  let vvSZapEstimator;
  let deployer;
  let feeTo;
  let wcro;
  let vvs;
  let tokenA;
  let tokenB;
  let tokenC;
  let tokenY;
  let tokenZ;
  let originalTokenList;
  let tokenAddressesInZap;
  let tokenSymbolToToken;
  let tokenAddressToToken;
  let tokenSymbolToTokenAddress;
  let tokenAddressToTokenSymbol;
  let LPAddressToLP;
  let LPAddressToLPName;
  let tokenPairAddressToLPAddress;
  before(async () => {
    const [signer1, signer2] = await ethers.getSigners();
    deployer = signer1;
    feeTo = signer2;
    wcro = await getMockExternalContract("WCRO", deployer);
    const someOfCroBalance = new BigNumber((await deployer.getBalance()).toString()).dividedToIntegerBy(4).multipliedBy(3).toString(10);
    await wcro.deposit({ value: `${someOfCroBalance}` });
    await initializeBasic();
  });
  beforeEach(async () => {
    try {
      await expectVVSZapTokenList(originalTokenList);
      await checkIntermediateTokenList();
      if (!LPAddressToLP || Object.keys(LPAddressToLP).length !== numberOfOriginalLP) {
        await initializeFactory();
      }
    } catch (err) {
      await initializeBasic();
    }
    await vvsZap.fetchLiquidityPoolsFromFactory();
  });
  async function checkIntermediateTokenList () {
    assert.equal((await vvsZap.intermediateTokens(wcro.address)).toString(), 0);
    assert.equal((await vvsZap.intermediateTokens(vvs.address)).toString(), 1);
    assert.equal(await vvsZap.getIntermediateToken(0), wcro.address);
    assert.equal(await vvsZap.getIntermediateToken(1), vvs.address);
    assert.equal(await vvsZap.getIntermediateTokenListLength(), 2);
  }
  async function initializeBasic () {
    if (isDebugMode) {
      console.log("Running initializeBasic...");
    }
    tokenSymbolToToken = {};
    tokenAddressToToken = {};
    tokenSymbolToTokenAddress = {};
    tokenAddressToTokenSymbol = {};
    initializeTokenMap("WCRO", wcro, wcro.address);
    vvs = await createToken("VVS", "VVS", "100000000000000000000000000000000");
    tokenA = await createToken("TokenA", "A", "1000000000000000000000000");
    tokenB = await createToken("TokenB", "B", "2000000000000000000000000");
    tokenC = await createToken("TokenC", "C", "4000000000000000000000000");
    tokenY = await createToken("TokenD", "D", "6000000000000000000000000");
    tokenZ = await createToken("TokenZ", "Z", "800000000000000000000");
    originalTokenList = [wcro, vvs, tokenA, tokenB, tokenC];
    tokenAddressesInZap = originalTokenList.map(token => token.address);
    if (isDebugMode) {
      console.log("tokenSymbolToTokenAddress", tokenSymbolToTokenAddress);
    }
    await initializeFactory();
  }
  async function initializeFactory () {
    if (isDebugMode) {
      console.log("Running initializeFactory...");
    }
    LPAddressToLP = {};
    LPAddressToLPName = {};
    tokenPairAddressToLPAddress = {};
    vvsFactory = await getMockExternalContract("VVSFactory", deployer, [feeTo.address]);
    vvsRouter = await getMockExternalContract("VVSRouter", deployer, [vvsFactory.address, wcro.address]);
    await createPairInFactory(wcro, vvs); // 1
    await createPairInFactory(wcro, tokenA); // 2
    await createPairInFactory(wcro, tokenB); // 3
    await createPairInFactory(wcro, tokenC); // 4
    await createPairInFactory(tokenA, tokenB); // 5
    await createPairInFactory(vvs, tokenC); // 6
    numberOfOriginalLP = 6; // = number of createPairInFactory() within this function
    if (isDebugMode) {
      console.log("LPAddressToLPName", LPAddressToLPName);
    }
    vvsZap = await (await ethers.getContractFactory("VVSZap")).deploy(wcro.address, vvsRouter.address);
    vvSZapEstimator = await (await ethers.getContractFactory("VVSZapEstimator")).deploy(vvsZap.address);
    await vvsZap.fetchLiquidityPoolsFromFactory();
    if (isDebugMode) {
      console.log("addIntermediateToken(vvs)...");
    }
    await vvsZap.addIntermediateToken(vvs.address);
  }
  async function createToken (name, symbol, totalSupply) {
    const token = await MockERC20.new(name, symbol, `${totalSupply}`);
    initializeTokenMap(symbol, token, token.address);
    return token;
  }
  function initializeTokenMap (symbol, token, tokenAddress) {
    tokenSymbolToToken[symbol] = token;
    tokenAddressToToken[token.address] = token;
    tokenSymbolToTokenAddress[symbol] = tokenAddress;
    tokenAddressToTokenSymbol[tokenAddress] = symbol;
    return token;
  }
  async function createPairInFactory (token0, token1) {
    const token0Address = await token0.address;
    const token1Address = await token1.address;
    if (isDebugMode) {
      console.log(`createPairInFactory ${tokenAddressToTokenSymbol[token0Address]}-${tokenAddressToTokenSymbol[token1Address]}`);
    }
    await vvsFactory.createPair(token0Address, token1Address);
    const LPAddress = await vvsFactory.getPair(token0Address, token1Address);
    const LP = await ethers.getContractAt("IVVSPair", LPAddress, deployer);
    LPAddressToLP[LPAddress] = LP;
    LPAddressToLPName[LPAddress] = `${tokenAddressToTokenSymbol[await LP.token0()]}-${
      tokenAddressToTokenSymbol[await LP.token1()]
    }`;
    if (!tokenPairAddressToLPAddress[token0Address]) {
      tokenPairAddressToLPAddress[token0Address] = {};
    }
    tokenPairAddressToLPAddress[token0Address][token1Address] = LPAddress;
    // add liquidity to factory
    await token0.approve(vvsRouter.address, MaxUint256);
    await token1.approve(vvsRouter.address, MaxUint256);
    await vvsRouter.addLiquidity(
      token0Address,
      token1Address,
      "2000000000000000000",
      "2000000000000000000",
      0,
      0,
      deployer.address,
      MaxUint256,
    );
  }
  function getLP (firstToken, secondToken) {
    return LPAddressToLP[tokenPairAddressToLPAddress[firstToken.address][secondToken.address]];
  }
  async function expectVVSZapTokenList (expectedArray) {
    const vvsZapTokenListLength = +((await vvsZap.getTokenListLength()).toString());
    const vvsZapTokenList = [];
    const vvsZapTokens = {};
    for (let i = 0; i < vvsZapTokenListLength; i++) {
      const address = await vvsZap.getToken(i);
      vvsZapTokenList.push(address);
      vvsZapTokens[address] = (await vvsZap.tokens(address)).toString();
    }
    try {
      assert.equal(vvsZapTokenListLength, expectedArray.length);
      for (let i = 0; i < expectedArray.length; i++) {
        const tokenAddress = expectedArray[i].address;
        assert.equal(vvsZapTokenList[i], tokenAddress);
        assert.equal(vvsZapTokens[tokenAddress], i + 1);
        assert.equal(await vvsZap.tokens(tokenAddress), i + 1);
      }
      await expectRevert(
        vvsZap.getToken(expectedArray.length),
        "VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)",
      );
    } catch (err) {
      throw new Error(
        `[expectVVSZapTokenList] token list mismatched as expected: 
        vvsZapTokens = ${JSON.stringify(vvsZapTokens, null, 2)}
        vvsZapTokenList = ${JSON.stringify(vvsZapTokenList, null, 2)}
        expectedArray = ${JSON.stringify(expectedArray.map(token => token.address), null, 2)}
        ${err.message}`);
    }
  }

  async function expectVVSZapIntermediateTokenList (expectedArray) {
    const vvsZapIntermediateTokenListLength = +((await vvsZap.getIntermediateTokenListLength()).toString());
    const vvsZapIntermediateTokenList = [];
    const vvsZapIntermediateTokens = {};
    for (let i = 0; i < vvsZapIntermediateTokenListLength; i++) {
      const address = await vvsZap.getIntermediateToken(i);
      vvsZapIntermediateTokenList.push(address);
      vvsZapIntermediateTokens[address] = (await vvsZap.intermediateTokens(address)).toString();
    }
    try {
      assert.equal(vvsZapIntermediateTokenListLength, expectedArray.length);
      for (let i = 0; i < expectedArray.length; i++) {
        const intermediateTokenAddress = expectedArray[i].address;
        assert.equal(vvsZapIntermediateTokenList[i], intermediateTokenAddress);
        assert.equal(vvsZapIntermediateTokens[intermediateTokenAddress], i + 1);
        assert.equal(await vvsZap.intermediateTokens(intermediateTokenAddress), i + 1);
      }
      await expectRevert(
        vvsZap.getIntermediateToken(expectedArray.length),
        "VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)",
      );
    } catch (err) {
      throw new Error(
        `[expectVVSZapIntermediateTokenList] intermediateToken list mismatched as expected: 
        vvsZapIntermediateTokens = ${JSON.stringify(vvsZapIntermediateTokens, null, 2)}
        vvsZapIntermediateTokenList = ${JSON.stringify(vvsZapIntermediateTokenList, null, 2)}
        expectedArray = ${JSON.stringify(expectedArray.map(intermediateToken => intermediateToken.address), null, 2)}
        ${err.message}`);
    }
  }
  async function expectVVSZapHasNoBalance () {
    for (const token of Object.values(tokenAddressToToken)) {
      const balanceInBaseUnit = await token.balanceOf(vvsZap.address);
      if (+balanceInBaseUnit !== 0) {
        throw new Error(
        `vvsZap contain balance: ${balanceInBaseUnit} ${await token.symbol()}`);
      }
    }
    for (const LP of Object.values(LPAddressToLP)) {
      const balanceInBaseUnit = await LP.balanceOf(vvsZap.address);
      if (+balanceInBaseUnit !== 0) {
        throw new Error(
        `vvsZap contain balance: ${balanceInBaseUnit} ${await LP.symbol()}`);
      }
    }
  }
  describe("zapIn", function () {
    this.timeout(120000);
    const inputAmount = 100000000000000000000;
    beforeEach(async () => {
      await wcro.approve(vvsZap.address, MaxUint256);
    });
    it("should revert when target LP not exist in factory and path is not initialized", async () => {
      await createPairInFactory(tokenY, tokenB);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      await expectRevertZapIn(getLP(tokenY, tokenB), inputAmount, "VVSZap:_getSuitableIntermediateToken: Does not support this route");
    });
    it("should revert when inputAmount = 0", async () => {
      for (const LP of Object.values(LPAddressToLP)) {
        await expectRevertZapIn(LP, 0, "VVSZap:zapIn: given amount should > 0");
      }
    });
    it("should swap inputToken to LP when LP includes wcro", async () => {
      await expectSuccessZapIn(getLP(wcro, tokenB), inputAmount);
    });
    it("should swap inputToken to LP when LP not include wcro", async () => {
      await expectSuccessZapIn(getLP(tokenA, tokenB), inputAmount);
    });
    async function expectRevertZapIn (LP, inputAmount, expectedErrorMsg) {
      await expectRevert(
        vvsZap.zapIn(LP.address, 0, { value: `${inputAmount}` }),
        expectedErrorMsg,
      );
    }
    async function expectSuccessZapIn (output, inputAmount) {
      const outputBalanceBeforeZapIn = await output.balanceOf(deployer.address);
      let outputAmountMin;
      if (LPAddressToLPName[output.address]) {
        estimation = await vvSZapEstimator.estimateZapInToLpSwapPaths(AddressZero, `${inputAmount}`, output.address);
        outputAmountMin = (await vvSZapEstimator.estimateAddLiquidityOutputAmount(estimation[2], estimation[3], output.address)).toString();
      } else {
        const [estimatedPath, estimatedAmounts] = await vvSZapEstimator.estimateZapTokenToTokenAmountsOut(AddressZero, output.address, `${
          inputAmount}`);
        outputAmountMin = estimatedAmounts[estimatedAmounts.length - 1].toString();
      }
      outputAmountMin = new BigNumber(outputAmountMin).multipliedBy(allowableSlippagePercent / 100).toString(10);
      const inputTokenBalanceBeforeZapIn = new BigNumber((await deployer.getBalance()).toString());
      const transaction = await vvsZap.zapIn(output.address, `${outputAmountMin}`, { value: `${inputAmount}` });
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "ZapIn", [output.address, inputAmount, SKIP_EVENT_PARAM_CHECK]);
      const inputTokenBalanceAfterZapIn = new BigNumber((await deployer.getBalance()).toString());
      const CROBalanceDiff = inputTokenBalanceBeforeZapIn
        .minus(inputTokenBalanceAfterZapIn.toString())
        .minus(await getTransactionFee(transaction))
        .toString();
      assert.equal(
        CROBalanceDiff,
        inputAmount,
      );
      assert.equal((await output.balanceOf(deployer.address)) > outputBalanceBeforeZapIn, true);
      await expectVVSZapHasNoBalance();
    }
  });
  describe("zapInToken", function () {
    this.timeout(120000);
    let inputToken;
    let LP;
    const inputAmount = 10000;
    describe("when no inputToken-intermediateTokens pair exist in factory", () => {
      beforeEach(async () => {
        inputToken = tokenY;
        LP = getLP(tokenA, tokenB);
        await createPairInFactory(inputToken, tokenC);
      });
      it("should swap to LP when path is initialized", async () => {
        await vvsZap.setPresetPath(inputToken.address, wcro.address, [inputToken.address, tokenC.address, wcro.address]);
        await expectSuccessZapInToken(inputToken, LP, inputAmount);
      });
      it("should revert when path is not initialized", async () => {
        await vvsZap.fetchLiquidityPoolsFromFactory();
        await expectRevertZapInToken(inputToken, LP, inputAmount,
          "VVSZap:_getPathForTokenToToken: Does not support this route");
      });
    });
    describe("when to is token", () => {
      it("should revert when inputToken is not supported", async () => {
        for (const inputToken of [tokenY, tokenZ]) {
          for (const outputTokenAddress of tokenAddressesInZap) {
            await expectRevertZapInToken(inputToken, tokenAddressToToken[outputTokenAddress], inputAmount,
              "VVSZap:zapInToken: given fromToken is not token");
          }
        }
      });
      it("should revert when inputToken = targetToken", async () => {
        for (const inputTokenAddress of tokenAddressesInZap) {
          const inputToken = tokenAddressToToken[inputTokenAddress];
          await expectRevertZapInToken(inputToken, inputToken, inputAmount,
            "VVSZap:_swapTokenToToken: Not Allow fromToken == toToken");
        }
      });
      it("should swap inputToken to targetToken when inputToken != targetToken", async () => {
        for (const inputTokenAddress of tokenAddressesInZap) {
          for (const outputTokenAddress of tokenAddressesInZap) {
            if (inputTokenAddress === outputTokenAddress) {
              continue;
            }
            await expectSuccessZapInToken(tokenAddressToToken[inputTokenAddress], tokenAddressToToken[outputTokenAddress], inputAmount);
          }
        }
      });
    });
    it("should swap inputToken to LP ", async () => {
      for (const inputToken of originalTokenList) {
        for (const LPAddress of Object.keys(LPAddressToLP)) {
          // console.log(`${tokenAddressToTokenSymbol[inputToken.address]} -> ${LPAddressToLPName[LPAddress]}`);
          await expectSuccessZapInToken(inputToken, LPAddressToLP[LPAddress], inputAmount);
        }
      }
    });
    async function expectRevertZapInToken (inputToken, output, inputAmount, expectedErrorMsg) {
      const inputTokenBalanceBeforeZapIn = await inputToken.balanceOf(deployer.address);
      await inputToken.approve(vvsZap.address, MaxUint256);
      await expectRevert(
        vvsZap.zapInToken(inputToken.address, inputAmount, output.address, 0),
        expectedErrorMsg,
      );
      assert.deepEqual(await inputToken.balanceOf(deployer.address), inputTokenBalanceBeforeZapIn);
    }
    async function expectSuccessZapInToken (inputToken, output, inputAmount) {
      const inputTokenBalanceBeforeZapIn = await inputToken.balanceOf(deployer.address);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      await inputToken.approve(vvsZap.address, MaxUint256);
      outputBalanceBeforeZapIn = await output.balanceOf(deployer.address);
      let outputAmountMin;
      if (LPAddressToLPName[output.address]) {
        estimation = await vvSZapEstimator.estimateZapInToLpSwapPaths(inputToken.address, inputAmount, output.address);
        outputAmountMin = (await vvSZapEstimator.estimateAddLiquidityOutputAmount(estimation[2], estimation[3], output.address)).toString();
      } else {
        const [estimatedPath, estimatedAmounts] = await vvSZapEstimator.estimateZapTokenToTokenAmountsOut(
          inputToken.address, output.address, inputAmount);
        outputAmountMin = estimatedAmounts[estimatedAmounts.length - 1].toString();
      }
      outputAmountMin = new BigNumber(outputAmountMin).multipliedBy(allowableSlippagePercent / 100).toString(10);
      const transaction = await vvsZap.zapInToken(inputToken.address, inputAmount, output.address, outputAmountMin);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "ZapInToken", [inputToken.address, output.address, inputAmount, SKIP_EVENT_PARAM_CHECK]);
      const inputTokenBalanceAfterZapInInBaseUnit = await inputToken.balanceOf(deployer.address);
      assert.equal(
        // should be equal. but there is some remaining token did not stake as LP which will return to user, therefore more then expected
        new BigNumber(inputTokenBalanceBeforeZapIn.toString()).minus(inputAmount)
          .isLessThanOrEqualTo(inputTokenBalanceAfterZapInInBaseUnit.toString()),
        true,
      );
      const outputBalanceAfterZapIn = new BigNumber((await output.balanceOf(deployer.address)).toString());
      assert.equal(outputBalanceAfterZapIn.isGreaterThan(outputBalanceBeforeZapIn.toString()), true);
      assert.equal(
        outputBalanceAfterZapIn.minus(outputBalanceBeforeZapIn.toString())
          .isGreaterThanOrEqualTo(outputAmountMin)
        , true,
      );
      await expectVVSZapHasNoBalance();
    }
  });
  describe("zapOut", function () {
    this.timeout(120000);
    const inputAmount = 100000000;
    it("should revert when outputToken is not supported", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        for (const output of [tokenY, tokenZ]) {
          await expectRevertZapOut(input, 0, output, "VVSZap:zapOut: given amount should > 0");
        }
      }
    });
    it("should revert when inputAmount = 0", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        for (const output of Object.values(LPAddressToLP)) {
          if (input.address === output.address) {
            continue;
          }
          await expectRevertZapOut(input, 0, output, "VVSZap:zapOut: given amount should > 0");
        }
      }
    });
    it("should revert when input is not LP", async () => {
      for (const input of originalTokenList) {
        for (const output of Object.values(LPAddressToLP)) {
          await expectRevertZapOut(input, inputAmount, output, "VVSZap:zapOut: should zap out from LP Address");
        }
      }
    });
    it("should revert when input LP = output LP", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        for (const output of Object.values(LPAddressToLP)) {
          if (input.address === output.address) {
            await expectRevertZapOut(input, inputAmount, output, "VVSZap:zapOut: input = output");
          }
        }
      }
    });
    it("should swap LP to token", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        for (const output of originalTokenList) {
          await expectSuccessZapOut(input, inputAmount, output);
        }
      }
    });
    it("should swap LP to LP", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        for (const output of Object.values(LPAddressToLP)) {
          if (input.address === output.address) {
            continue;
          }
          await expectSuccessZapOut(input, inputAmount, output);
        }
      }
    });
    it("should swap LP to CRO", async () => {
      for (const input of Object.values(LPAddressToLP)) {
        await input.approve(vvsZap.address, MaxUint256);
        const inputBalanceBeforeZapOut = await input.balanceOf(deployer.address);
        const outputBalanceBeforeZapOut = await deployer.getBalance();
        const estimation = await vvSZapEstimator.estimateZapOutToTokenOutputAmount(input.address, inputAmount, constants.AddressZero);
        const outputAmountMin = new BigNumber(estimation[2].toString()).multipliedBy(allowableSlippagePercent / 100).toString(10);
        const transaction = await vvsZap.zapOut(input.address, inputAmount, constants.AddressZero, 0);
        await checkGasUsed(transaction, { maxGasUsed });
        await expectEvent(transaction, "ZapOut", [input.address, constants.AddressZero, inputAmount, SKIP_EVENT_PARAM_CHECK]);
        assert.equal(
          await input.balanceOf(deployer.address),
          new BigNumber(inputBalanceBeforeZapOut.toString()).minus(inputAmount).toString(10),
        );
        const currentDeployerCroBalance = new BigNumber((await deployer.getBalance()).toString());
        const CROBalanceDiff = currentDeployerCroBalance
          .minus(outputBalanceBeforeZapOut.toString())
          .plus(await getTransactionFee(transaction));
        assert.equal(
          currentDeployerCroBalance.isGreaterThan(new BigNumber(outputBalanceBeforeZapOut.toString()).minus(await getTransactionFee(transaction)))
          , true,
        );
        assert.equal(
          CROBalanceDiff.isGreaterThanOrEqualTo(outputAmountMin)
          , true,
        );
      }
    });
    async function expectRevertZapOut (input, inputAmount, output, expectedErrorMsg) {
      const inputBalanceBeforeZapOut = await input.balanceOf(deployer.address);
      const outputBalanceBeforeZapOut = await output.balanceOf(deployer.address);
      await input.approve(vvsZap.address, MaxUint256);
      await expectRevert(
        vvsZap.zapOut(input.address, inputAmount, output.address, 0),
        expectedErrorMsg,
      );
      assert.deepEqual(await input.balanceOf(deployer.address), inputBalanceBeforeZapOut);
      assert.deepEqual(await output.balanceOf(deployer.address), outputBalanceBeforeZapOut);
    }
    async function expectSuccessZapOut (input, inputAmount, output) {
      await input.approve(vvsZap.address, MaxUint256);
      const inputBalanceBeforeZapOut = await input.balanceOf(deployer.address);
      const outputBalanceBeforeZapOut = await output.balanceOf(deployer.address);
      const transaction = await vvsZap.zapOut(input.address, inputAmount, output.address, 0);// %%%%
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "ZapOut", [input.address, output.address, inputAmount, SKIP_EVENT_PARAM_CHECK]);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      assert.equal(
        await input.balanceOf(deployer.address),
        new BigNumber(inputBalanceBeforeZapOut.toString()).minus(inputAmount).toString(10),
      );
      assert.equal((await output.balanceOf(deployer.address)) > outputBalanceBeforeZapOut, true);
      const outputBalanceAfterZapOut = new BigNumber((await output.balanceOf(deployer.address)).toString());
      if (tokenAddressToTokenSymbol[output.address]) {
        const estimation = await vvSZapEstimator.estimateZapOutToTokenOutputAmount(input.address, inputAmount, output.address);
        const outputBalanceDiff = outputBalanceAfterZapOut.minus(outputBalanceBeforeZapOut.toString());
        assert.equal(
          outputBalanceDiff.isGreaterThanOrEqualTo((estimation[2] * 0.95).toString())
          , true,
        );
      }
      await expectVVSZapHasNoBalance();
    }
  });
  describe("getPresetPath / setPresetPath / removePresetPath / setPresetPathByAutoCalculation", () => {
    it("should return correct path from vvsZap.paths", async () => {
      assert.deepEqual(await vvsZap.getPresetPath(tokenC.address, tokenA.address), []);
      const path = [tokenC.address, wcro.address, tokenA.address];
      // setPresetPath
      let transaction = await vvsZap.setPresetPath(tokenC.address, tokenA.address, path);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "SetPresetPath", [tokenC.address, tokenA.address, path, false]);
      assert.deepEqual(await vvsZap.getPresetPath(tokenC.address, tokenA.address), path);
      // removePresetPath
      transaction = await vvsZap.removePresetPath(tokenC.address, tokenA.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemovePresetPath", [tokenC.address, tokenA.address]);
      assert.deepEqual(await vvsZap.getPresetPath(tokenC.address, tokenA.address), []);
      transaction = await vvsZap.setPresetPathByAutoCalculation(tokenC.address, tokenA.address);
      // setPresetPathByAutoCalculation
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "SetPresetPath", [tokenC.address, tokenA.address, path, true]);
      assert.deepEqual(await vvsZap.getPresetPath(tokenC.address, tokenA.address), path);
    });
  });
  describe("getLiquidityPoolAddress", () => {
    it("should return correct address from factory", async () => {
      for (const [token1, token2] of [
        [wcro, tokenA],
        [wcro, tokenB],
        [tokenA, tokenB],
      ]) {
        assert.equal(
          await vvsZap.getLiquidityPoolAddress(token1.address, token2.address),
          tokenPairAddressToLPAddress[token1.address][token2.address],
        );
      }
    });
  });
  describe("isLiquidityPoolExistInFactory", () => {
    it("should return correct result according to factory getPair", async () => {
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(wcro.address, tokenA.address), true);
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(wcro.address, tokenB.address), true);
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(wcro.address, tokenC.address), true);
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(tokenA.address, tokenB.address), true);
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(tokenA.address, tokenC.address), false);
      assert.equal(await vvsZap.isLiquidityPoolExistInFactory(tokenB.address, tokenC.address), false);
    });
  });
  describe("fetchLiquidityPoolsFromFactoryWithIndex / getToken / addToken / removeToken / getTokenListLength", () => {
    const maxGasUsedForTokenUpdate = 400000;
    it("should add new token to tokenList and tokenSymbolToToken by addToken", async () => {
      const transaction = await vvsZap.addToken(tokenZ.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "AddToken", [tokenZ.address, false]);
      await expectVVSZapTokenList([wcro, vvs, tokenA, tokenB, tokenC, tokenZ]);
    });
    it("should remove token from tokenList and tokenSymbolToToken by removeToken", async () => {
      const transaction = await vvsZap.removeToken(tokenA.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenA.address]);
      await expectVVSZapTokenList([wcro, vvs, tokenC, tokenB]);
    });
    it("should revert when intermediate token already exist", async () => {
      await expectRevert(
        vvsZap.addToken(wcro.address),
        "VVSZap:addToken: _tokenAddress is already in token list",
      );
      await expectRevert(
        vvsZap.addToken(vvs.address),
        "VVSZap:addToken: _tokenAddress is already in token list",
      );
    });
    it("should remove token from tokenList and tokenSymbolToToken and add it back again", async () => {
      // remove tokenA
      let transaction = await vvsZap.removeToken(tokenA.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenA.address]);
      await expectVVSZapTokenList([wcro, vvs, tokenC, tokenB]);
      // add tokenA back
      transaction = await vvsZap.addToken(tokenA.address);
      await expectEvent(transaction, "AddToken", [tokenA.address, false]);
      await expectVVSZapTokenList([wcro, vvs, tokenC, tokenB, tokenA]);
      // remove tokenA again
      transaction = await vvsZap.removeToken(tokenA.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenA.address]);
      await expectVVSZapTokenList([wcro, vvs, tokenC, tokenB]);
      // add tokenA back again
      transaction = await vvsZap.addToken(tokenA.address);
      await expectEvent(transaction, "AddToken", [tokenA.address, false]);
      await expectVVSZapTokenList([wcro, vvs, tokenC, tokenB, tokenA]);
    });
    it("should update tokens and tokenList correctly when addToken or removeToken again and again", async () => {
      let transaction = await vvsZap.addToken(tokenZ.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "AddToken", [tokenZ.address, false]);
      await expectVVSZapTokenList([wcro, vvs, tokenA, tokenB, tokenC, tokenZ]);
      transaction = await vvsZap.removeToken(tokenA.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenA.address]);
      await expectVVSZapTokenList([wcro, vvs, tokenZ, tokenB, tokenC]);
      transaction = await vvsZap.addToken(tokenA.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "AddToken", [tokenA.address, false]);
      transaction = await vvsZap.addToken(tokenY.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "AddToken", [tokenY.address, false]);
      await expectVVSZapTokenList([wcro, vvs, tokenZ, tokenB, tokenC, tokenA, tokenY]);
      transaction = await vvsZap.removeToken(tokenC.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenC.address]);
      await expectVVSZapTokenList([wcro, vvs, tokenZ, tokenB, tokenY, tokenA]);
      transaction = await vvsZap.removeToken(wcro.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [wcro.address]);
      await expectVVSZapTokenList([tokenA, vvs, tokenZ, tokenB, tokenY]);
      transaction = await vvsZap.removeToken(tokenY.address);
      await checkGasUsed(transaction, { maxGasUsedForTokenUpdate });
      await expectEvent(transaction, "RemoveToken", [tokenY.address]);
      await expectVVSZapTokenList([tokenA, vvs, tokenZ, tokenB]);
    });
  });
  describe("get / set / remove IntermediateToken  / getIntermediateTokenListLength", () => {
    it("should only contain WCRO right after VVSZap created", async () => {
      assert.equal(await vvsZap.getIntermediateToken(0), wcro.address);
      assert.equal(await vvsZap.getIntermediateToken(1), vvs.address);
      assert.equal(await vvsZap.getIntermediateTokenListLength(), 2);
    });
    it("should revert when intermediate token already exist", async () => {
      await expectRevert(
        vvsZap.addIntermediateToken(wcro.address),
        "VVSZap:addIntermediateToken: _tokenAddress is already in token list",
      );
      await expectRevert(
        vvsZap.addIntermediateToken(vvs.address),
        "VVSZap:addIntermediateToken: _tokenAddress is already in token list",
      );
    });
    it("should add new token to intermediateTokenList by addIntermediateToken", async () => {
      const transaction = await vvsZap.addIntermediateToken(tokenY.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "AddIntermediateToken", [tokenY.address]);
      assert.equal(await vvsZap.getIntermediateToken(0), wcro.address);
      assert.equal(await vvsZap.getIntermediateToken(1), vvs.address);
      assert.equal(await vvsZap.getIntermediateToken(2), tokenY.address);
      assert.equal(await vvsZap.intermediateTokens(wcro.address), 1);
      assert.equal((await vvsZap.intermediateTokens(vvs.address)).toString(), 2);
      assert.equal((await vvsZap.intermediateTokens(tokenY.address)).toString(), 3);
      await expectRevert(
        vvsZap.getIntermediateToken(3),
        "VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)",
      );
      assert.equal(await vvsZap.getIntermediateTokenListLength(), 3);
    });
    it("should remove token from intermediateTokenList by removeIntermediateToken", async () => {
      const transaction = await vvsZap.removeIntermediateToken(wcro.address);
      assert.equal((await vvsZap.intermediateTokens(wcro.address)).toString(), 0);
      assert.equal((await vvsZap.intermediateTokens(vvs.address)).toString(), 1);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemoveIntermediateToken", [wcro.address]);
      await expectRevert(
        vvsZap.getIntermediateToken(1),
        "VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)",
      );
      assert.equal(await vvsZap.getIntermediateTokenListLength(), 1);
    });
    it("should remove token from intermediateTokenList and add it back again", async () => {
      await expectVVSZapIntermediateTokenList([wcro, vvs]);
      // remove wcro
      let transaction = await vvsZap.removeIntermediateToken(wcro.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemoveIntermediateToken", [wcro.address]);
      await expectVVSZapIntermediateTokenList([vvs]);

      // add wcro back again
      transaction = await vvsZap.addIntermediateToken(wcro.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "AddIntermediateToken", [wcro.address]);
      await expectVVSZapIntermediateTokenList([vvs, wcro]);

      // remove wcro again
      transaction = await vvsZap.removeIntermediateToken(wcro.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemoveIntermediateToken", [wcro.address]);
      await expectVVSZapIntermediateTokenList([vvs]);

      // add wcro back again
      transaction = await vvsZap.addIntermediateToken(wcro.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "AddIntermediateToken", [wcro.address]);
      await expectVVSZapIntermediateTokenList([vvs, wcro]);

      // remove vvs
      transaction = await vvsZap.removeIntermediateToken(vvs.address);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemoveIntermediateToken", [vvs.address]);
      await expectVVSZapIntermediateTokenList([wcro]);
    });
  });
  describe("addLiquidityPool / isLP / removeLiquidityPool", () => {
    it("should return false when for token addresses", async () => {
      for (const address of Object.keys(tokenAddressToToken)) {
        assert.equal(await vvsZap.isLP(address), false);
      }
    });
    it("should return true when for lp addresses", async () => {
      for (const address of Object.keys(LPAddressToLP)) {
        assert.equal(await vvsZap.isLP(address), true);
      }
    });
    it("should return according to liquidityPools", async () => {
      for (const address of Object.keys(tokenAddressToToken)) {
        assert.equal(await vvsZap.isLP(address), false);
      }
      for (const address of Object.keys(LPAddressToLP)) {
        assert.equal(await vvsZap.isLP(address), true);
      }
      await createPairInFactory(tokenY, tokenA);
      const targetLPAddress = getLP(tokenY, tokenA).address;
      assert.equal(await vvsZap.isLP(targetLPAddress), false);
      let transaction = await vvsZap.addLiquidityPool(targetLPAddress);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "AddLiquidityPool", [targetLPAddress, false]);
      assert.equal(await vvsZap.isLP(targetLPAddress), true);
      transaction = await vvsZap.removeLiquidityPool(targetLPAddress);
      await checkGasUsed(transaction, { maxGasUsed });
      await expectEvent(transaction, "RemoveLiquidityPool", [targetLPAddress]);
      assert.equal(await vvsZap.isLP(targetLPAddress), false);
      await initializeFactory();
    });
  });
  describe("fetchLiquidityPoolsFromFactory", () => {
    it("when only 1 token in new LP do not exist in original tokenList", async () => {
      const transaction = await vvsZap.fetchLiquidityPoolsFromFactory();
      const lastLPIndex = Object.keys(LPAddressToLP).length - 1;
      try {
        await checkGasUsed(transaction, { maxGasUsed });
        await expectEvent(transaction, "FetchLiquidityPoolsFromFactory", [0, lastLPIndex]);
      } catch (err) {
        expect(err.message).to.be.contains("Expected event not exist");
      }
    });
  });
  describe("fetchLiquidityPoolsFromFactoryWithIndex / isToken / isLP/ getToken / getTokenListLength", () => {
    describe("should have new tokens and LPs according to after fetchLiquidityPoolsFromFactoryWithIndex", function () {
      this.timeout(120000);
      it("when only 1 token in new LP do not exist in original tokenList", async () => {
        for (const newToken of [tokenY, tokenZ]) {
          for (const oldToken of originalTokenList) {
            await initializeFactory();
            await expectCorrect(newToken, oldToken, [...originalTokenList, newToken]);
          }
        }
      });
      it("when both token in new LP do not exist in original tokenList", async () => {
        let expectedFinalTokenList;
        if (+tokenY.address < +tokenZ.address) {
          expectedFinalTokenList = [...originalTokenList, tokenY, tokenZ];
        } else {
          expectedFinalTokenList = [...originalTokenList, tokenZ, tokenY];
        }
        await expectCorrect(tokenY, tokenZ, expectedFinalTokenList);
      });
      async function expectCorrect (newLPToken1, newLPToken2, expectedFinalTokenList) {
        for (const address of tokenAddressesInZap) {
          assert.equal(await vvsZap.isToken(address), true);
        }
        for (const address of Object.keys(LPAddressToLP)) {
          assert.equal(await vvsZap.isLP(address), true);
        }
        await expectVVSZapTokenList(originalTokenList);
        await createPairInFactory(newLPToken1, newLPToken2);
        await expectVVSZapTokenList(originalTokenList);
        let transaction = await vvsZap.fetchLiquidityPoolsFromFactoryWithIndex(0, 10);
        await expectVVSZapTokenList(expectedFinalTokenList);
        const lastLPIndex = Object.keys(LPAddressToLP).length - 1;
        await checkGasUsed(transaction, { maxGasUsed });
        await expectEvent(transaction, "FetchLiquidityPoolsFromFactory", [0, lastLPIndex]);
        for (const address of Object.keys(LPAddressToLP)) {
          assert.equal(await vvsZap.isLP(address), true);
        }
        for (const token of expectedFinalTokenList) {
          assert.equal(await vvsZap.isToken(token.address), true);
        }
        assert.equal(await vvsZap.lastFetchedPairIndex(), lastLPIndex);
        transaction = await vvsZap.fetchLiquidityPoolsFromFactoryWithIndex(lastLPIndex, 10);
        await checkGasUsed(transaction, { maxGasUsed });
        await expectEvent(transaction, "FetchLiquidityPoolsFromFactory", [lastLPIndex, lastLPIndex]);
      }
    });
  });
  describe("getAutoCalculatedPathWithIntermediateTokenForTokenToToken", () => {
    it("should return correct auto path", async () => {
      await createPairInFactory(tokenZ, vvs);
      await createPairInFactory(tokenB, vvs);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      assert.deepEqual(
        await vvsZap.getAutoCalculatedPathWithIntermediateTokenForTokenToToken(tokenZ.address, tokenB.address),
        [tokenZ.address, vvs.address, tokenB.address],
      );
      await createPairInFactory(tokenB, tokenZ);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      assert.deepEqual(
        await vvsZap.getAutoCalculatedPathWithIntermediateTokenForTokenToToken(tokenZ.address, tokenB.address),
        [tokenZ.address, vvs.address, tokenB.address],
      );
      await vvsZap.addIntermediateToken(tokenZ.address);
      assert.deepEqual(
        await vvsZap.getAutoCalculatedPathWithIntermediateTokenForTokenToToken(tokenZ.address, tokenB.address),
        [tokenZ.address, vvs.address, tokenB.address],
      );
    });
  });
  describe("getPathForTokenToToken", () => {
    it("should return correct path", async () => {
      assert.deepEqual(await vvsZap.getPathForTokenToToken(tokenA.address, tokenB.address), [tokenA.address, tokenB.address]);
      assert.deepEqual(await vvsZap.getPathForTokenToToken(tokenC.address, tokenA.address), [tokenC.address, wcro.address, tokenA.address]);
      assert.deepEqual(await vvsZap.getPathForTokenToToken(tokenC.address, tokenB.address), [tokenC.address, wcro.address, tokenB.address]);
    });
    it("should return correct path for new pair", async () => {
      await createPairInFactory(tokenZ, vvs);
      await createPairInFactory(tokenB, vvs);
      await vvsZap.fetchLiquidityPoolsFromFactory();
      assert.deepEqual(await vvsZap.getPathForTokenToToken(tokenZ.address, tokenB.address), [tokenZ.address, vvs.address, tokenB.address]);
      await vvsZap.addIntermediateToken(tokenZ.address);
      assert.deepEqual(await vvsZap.getPathForTokenToToken(tokenZ.address, tokenB.address), [tokenZ.address, vvs.address, tokenB.address]);
    });
  });
  describe("getSuitableIntermediateTokenForTokenToLP", () => {
    it("should return correct SuitableIntermediateToken", async () => {
      await createPairInFactory(tokenZ, vvs);
      await createPairInFactory(tokenA, tokenC);
      for (const [inputToken, pair, expectedIntermediateToken] of [
        [wcro, [wcro, tokenA], wcro], // IntermediateToken is not necessary
        [vvs, [wcro, tokenA], wcro],
        [vvs, [wcro, tokenC], wcro],
        [vvs, [vvs, tokenC], vvs], // IntermediateToken is not necessary
        [tokenA, [wcro, tokenA], tokenA], // IntermediateToken is not necessary
        [tokenA, [vvs, tokenC], vvs],
        [tokenC, [vvs, tokenC], tokenC], // IntermediateToken is not necessary
        [wcro, [wcro, vvs], wcro], // IntermediateToken is not necessary
        [vvs, [wcro, vvs], vvs], // IntermediateToken is not necessary
        [tokenA, [tokenA, tokenB], tokenA], // IntermediateToken is not necessary
        [tokenZ, [tokenA, tokenB], wcro], // no direct LP for vvs-tokenA vvs-tokenB
        [tokenA, [tokenA, tokenC], tokenA], // IntermediateToken is not necessary
        [tokenZ, [tokenA, tokenC], wcro], // even if there is direct LP for vvs-tokenZ, wcro is pick as it doesnt do path length comparison
        [tokenZ, [wcro, vvs], vvs], // both wcro vvs are IntermediateToken, but vvs is pick because of vvs-tokenZ exist
      ]) {
        assert.deepEqual(
          await vvsZap.getSuitableIntermediateTokenForTokenToLP(inputToken.address,
            tokenPairAddressToLPAddress[pair[0].address][pair[1].address]),
          expectedIntermediateToken.address,
        );
      }
    });
  });
  describe("withdrawBalance", () => {
    const amount = 2000;
    it("should withdraw all balance when withdrawBalance with amount 0 (ERC20)", async () => {
      await tokenA.transfer(vvsZap.address, amount);
      const balance = await tokenA.balanceOf(deployer.address);
      await vvsZap.withdrawBalance(tokenA.address, 0);
      assert.equal(+(await tokenA.balanceOf(deployer.address)), +balance + amount);
    });
    it("should withdraw all balance when withdrawBalance with amount 0 (CRO)", async () => {
      await deployer.sendTransaction({ to: vvsZap.address, value: amount });
      const balance = await deployer.getBalance();
      const transaction = await vvsZap.withdrawBalance(AddressZero, 0);
      assert.deepEqual(
        (await deployer.getBalance()).toString(),
        new BigNumber(balance.toString()).plus(amount).minus(await getTransactionFee(transaction)).toString(10),
      );
    });
    it("should withdraw when withdrawBalance for all balance (ERC20)", async () => {
      await tokenA.transfer(vvsZap.address, amount);
      const balance = await tokenA.balanceOf(deployer.address);
      await vvsZap.withdrawBalance(tokenA.address, amount);
      assert.equal(+(await tokenA.balanceOf(deployer.address)), +balance + amount);
    });
    it("should withdraw when withdrawBalance for all balance (CRO)", async () => {
      await deployer.sendTransaction({ to: vvsZap.address, value: amount });
      const balance = await deployer.getBalance();
      const transaction = await vvsZap.withdrawBalance(AddressZero, amount);
      assert.deepEqual(
        (await deployer.getBalance()).toString(),
        new BigNumber(balance.toString()).plus(amount).minus(await getTransactionFee(transaction)).toString(10),
      );
    });
    it("should withdraw when withdrawBalance for part of balance (ERC20)", async () => {
      await tokenA.transfer(vvsZap.address, amount);
      const balance = await tokenA.balanceOf(deployer.address);
      await vvsZap.withdrawBalance(tokenA.address, amount / 2);
      assert.equal(+(await tokenA.balanceOf(deployer.address)), +balance + amount / 2);
    });
    it("should withdraw when withdrawBalance for part of balance (CRO)", async () => {
      await deployer.sendTransaction({ to: vvsZap.address, value: amount });
      const balance = await deployer.getBalance();
      const transaction = await vvsZap.withdrawBalance(AddressZero, amount / 2);
      assert.deepEqual(
        (await deployer.getBalance()).toString(),
        new BigNumber(balance.toString()).plus(amount / 2).minus(await getTransactionFee(transaction)).toString(10),
      );
    });
  });
});
