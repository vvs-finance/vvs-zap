const BigNumber = require("bignumber.js");
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 0 });
const fs = require("fs");

async function getTransactionFee (transaction) {
  const transactionReceipt = await (transaction).wait();
  return new BigNumber(transaction.gasPrice.toString()).multipliedBy(
    transactionReceipt.gasUsed.toString(),
  ).toString(10);
}

async function checkGasUsed (transaction, config = {}) {
  if (!config.maxGasUsed) {
    config.maxGasUsed = 80000;
  }
  if (!config.isDebugMode) {
    config.isDebugMode = false;
  }
  const transactionReceipt = await transaction.wait();
  if (+transactionReceipt.gasUsed > +config.maxGasUsed) {
    throw new Error(`Gas Used Too Much - ${+transactionReceipt.gasUsed} Max:${config.maxGasUsed}`);
  }
  if (config.isDebugMode) {
    console.log("gasUsed: ", transactionReceipt.gasUsed);
  }
}

const SKIP_EVENT_PARAM_CHECK = "SKIP"; // use this const for those unable to expect exact result's event param , checking will be skipped
async function expectEvent (transaction, eventName, param) {
  const transactionReceipt = await transaction.wait();
  for (const event of transactionReceipt.events) {
    if (event.event === eventName && event.args.length === param.length) {
      const results = [];
      for (let i = 0; i < param.length; i++) {
        if (event.args[i].toString() === `${param[i]}` || SKIP_EVENT_PARAM_CHECK === `${param[i]}`) {
          results.push(true);
        } else {
          results.push(false);
        }
      }
      if (!results.includes(false)) {
        return true;
      }
    }
  }
  throw new Error(`Expected event not exist - ${eventName} ${JSON.stringify(param)} - ${
    JSON.stringify(transactionReceipt, null, 2)
  }`);
}

async function getMockExternalContract (fileName, deployer, args) {
  return await getMockContractByArtifact(
    JSON.parse(fs.readFileSync(`artifacts-external/${fileName}.json`, "utf-8")),
    deployer, args);
}

async function getMockContractByArtifact (artifact, deployer, args) {
  let factory;
  const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  if (!args) {
    factory = await Factory.deploy();
  } else {
    factory = await Factory.deploy(...args);
  }
  await factory.deployed();
  return factory;
}

module.exports = {
  getTransactionFee,
  checkGasUsed,
  SKIP_EVENT_PARAM_CHECK,
  expectEvent,
  getMockExternalContract,
  getMockContractByArtifact,
};
