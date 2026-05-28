const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

const FRONTEND = path.join(__dirname, "../frontend");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Factory  = await hre.ethers.getContractFactory("BlockShareSentinel");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Deployed to:", address);

  fs.mkdirSync(FRONTEND, { recursive: true });

  fs.writeFileSync(path.join(FRONTEND, "deployment.json"), JSON.stringify({
    address,
    network:    hre.network.name,
    chainId:    (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer:   deployer.address
  }, null, 2));

  const artifact = await hre.artifacts.readArtifact("BlockShareSentinel");
  fs.writeFileSync(path.join(FRONTEND, "abi.json"), JSON.stringify(artifact.abi, null, 2));

  console.log("deployment.json and abi.json written to frontend/");
}

main().catch((e) => { console.error(e); process.exit(1); });
