import { JsonRpcProvider, formatEther, formatUnits } from "ethers";

const SEPOLIA_RPC = "https://sepolia.base.org";
const MAINNET_RPC = "https://mainnet.base.org";

const sepolia = new JsonRpcProvider(SEPOLIA_RPC);
const mainnet = new JsonRpcProvider(MAINNET_RPC);

// Deploy txs from ignition/deployments/chain-84532/journal.jsonl
const deploys = [
  ["CodeQuillDelegation",          "0x99530b6af195d4116fe4ab40bdf6332c77e8d095e2ea4823e98235d55cd4cb4e"],
  ["CodeQuillWorkspaceNFT",        "0x7182a837c14af201e9c6a1ca969ebd63c60dc5282aedf70ddf33a277319b6bda"],
  ["CodeQuillWorkspaceRegistry",   "0xc1d4f8ce4fdd8378e634f656fb794bb1b35cad0d78b60be81d2e95da45ee764f"],
  ["CodeQuillRepositoryRegistry",  "0x4ac63a793814d1b2813ec8d5ca5c9d9caa297f4f7d2bc9e5ecc7e3a4728c18ea"],
  ["CodeQuillSnapshotRegistry",    "0x7ffc6c4d9647c9d05b866b763e91bfa211ba06ce65ba486690225d546739e426"],
  ["CodeQuillPreservationRegistry","0x7f28af473ed4ace010861f15e12065b47eae55c136222c8d0ebdd685f64aaf6a"],
  ["CodeQuillReleaseRegistry",     "0x880399595aefc3152a608d73641ba35fc970d03e28c5b92c3a13ea913e47b139"],
  ["CodeQuillAttestationRegistry", "0xd8222b17e43e82caf9e20b100bfa8e6dac76ffe7791a554e4d0a7590088d2284"],
];

console.log("Fetching Base Sepolia receipts (last deploy of the same bytecode pre-audit)...\n");

let totalGas = 0n;
const rows = [];
for (const [name, hash] of deploys) {
  const r = await sepolia.getTransactionReceipt(hash);
  if (!r) { rows.push([name, "MISSING", "—"]); continue; }
  totalGas += r.gasUsed;
  rows.push([name, r.gasUsed.toString(), `block ${r.blockNumber}`]);
}

console.log("Per-contract deploy gas (Base Sepolia, audit-fix bytecode will be ~same):");
for (const [n, g, b] of rows) {
  console.log(`  ${n.padEnd(32)} ${g.padStart(10)}  ${b}`);
}
console.log(`  ${"TOTAL".padEnd(32)} ${totalGas.toString().padStart(10)}  gas units\n`);

// Current Base mainnet gas price
const feeData = await mainnet.getFeeData();
const baseFee = (await mainnet.getBlock("latest"))?.baseFeePerGas ?? 0n;
const tip = feeData.maxPriorityFeePerGas ?? 1_000_000n; // 0.001 gwei default
const effective = baseFee + tip;

console.log("Current Base mainnet fee data:");
console.log(`  base fee         : ${formatUnits(baseFee, "gwei")} gwei`);
console.log(`  priority tip     : ${formatUnits(tip, "gwei")} gwei`);
console.log(`  effective gas px : ${formatUnits(effective, "gwei")} gwei`);
console.log(`  maxFeePerGas hint: ${formatUnits(feeData.maxFeePerGas ?? 0n, "gwei")} gwei\n`);

const costWei = totalGas * effective;
console.log(`Estimated deploy cost: ${formatEther(costWei)} ETH at current Base mainnet rates`);

// Conservative 2x buffer (gas spikes happen)
const buffered = costWei * 2n;
console.log(`Suggested deployer ETH (2x buffer): ${formatEther(buffered)} ETH\n`);

// Optional USD equivalent via Coinbase public price
try {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  const j = await r.json();
  const px = parseFloat(j.data?.amount ?? "0");
  if (px > 0) {
    const eth = parseFloat(formatEther(costWei));
    const bufEth = parseFloat(formatEther(buffered));
    console.log(`At ETH = $${px.toFixed(2)}:`);
    console.log(`  estimated  : $${(eth * px).toFixed(2)}`);
    console.log(`  with buffer: $${(bufEth * px).toFixed(2)}`);
  }
} catch {}
