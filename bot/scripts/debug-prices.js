// Debug script - check actual prices on Arbitrum DEXes
const { ethers } = require('ethers');
require('dotenv').config();

const RPC_URL = process.env.ARBITRUM_RPC_URL || 'https://arb-mainnet.g.alchemy.com/v2/YXcfI6Jc9OMS2LyRRpGGH';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Token addresses
const TOKENS = {
  WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USDC_E: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
};

const SUSHISWAP = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const CAMELOT = '0xc873fEcbd354f5A56E00E710B90EF4201db2448d';

const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)',
];

async function getAmountsOut(router, path, amountIn) {
  const contract = new ethers.Contract(router, ROUTER_ABI, provider);
  try {
    const amounts = await contract.getAmountsOut.staticCall(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (e) {
    return 0n;
  }
}

async function main() {
  console.log('========================================');
  console.log('  Arbitrum Price Debugger');
  console.log('========================================\n');

  const amount = 1000000000n; // 1000 USDC (6 decimals)

  // 1. Check USDC → USDC.e prices
  console.log('📊 USDC → USDC.e (should be ~1:1)');
  console.log('-----------------------------------');
  
  const sushi_usdc_usdce = await getAmountsOut(SUSHISWAP, [TOKENS.USDC, TOKENS.USDC_E], amount);
  console.log('SushiSwap: 1000 USDC →', (Number(sushi_usdc_usdce) / 1e6).toFixed(6), 'USDC.e');
  
  const camelot_usdc_usdce = await getAmountsOut(CAMELOT, [TOKENS.USDC, TOKENS.USDC_E], amount);
  console.log('Camelot:   1000 USDC →', (Number(camelot_usdc_usdce) / 1e6).toFixed(6), 'USDC.e');

  if (sushi_usdc_usdce > 0n && camelot_usdc_usdce > 0n) {
    const diff = Number(sushi_usdc_usdce - camelot_usdc_usdce) / 1e6;
    console.log('Difference:', Math.abs(diff).toFixed(4), 'USDC');
  }

  // 2. Check reverse: USDC.e → USDC
  console.log('\n📊 USDC.e → USDC');
  console.log('-----------------------------------');
  
  const sushi_usdce_usdc = await getAmountsOut(SUSHISWAP, [TOKENS.USDC_E, TOKENS.USDC], amount);
  console.log('SushiSwap: 1000 USDC.e →', (Number(sushi_usdce_usdc) / 1e6).toFixed(6), 'USDC');
  
  const camelot_usdce_usdc = await getAmountsOut(CAMELOT, [TOKENS.USDC_E, TOKENS.USDC], amount);
  console.log('Camelot:   1000 USDC.e →', (Number(camelot_usdce_usdc) / 1e6).toFixed(6), 'USDC');

  // 3. WETH prices
  console.log('\n📊 WETH → USDC');
  console.log('-----------------------------------');
  const oneWETH = ethers.parseEther('1');
  
  const sushi_weth_usdc = await getAmountsOut(SUSHISWAP, [TOKENS.WETH, TOKENS.USDC], oneWETH);
  console.log('SushiSwap: 1 WETH →', (Number(sushi_weth_usdc) / 1e6).toFixed(2), 'USDC');
  
  const camelot_weth_usdc = await getAmountsOut(CAMELOT, [TOKENS.WETH, TOKENS.USDC], oneWETH);
  console.log('Camelot:   1 WETH →', (Number(camelot_weth_usdc) / 1e6).toFixed(2), 'USDC');

  if (sushi_weth_usdc > 0n && camelot_weth_usdc > 0n) {
    const diff = Number(sushi_weth_usdc - camelot_weth_usdc) / 1e6;
    console.log('Difference:', Math.abs(diff).toFixed(2), 'USDC (', (Math.abs(diff)/1800*100).toFixed(4), '%)');
  }

  // 4. Triangular test
  console.log('\n📊 Triangular: USDC → WETH → USDC_E → USDC');
  console.log('-----------------------------------');
  
  // Leg 1: USDC → WETH on SushiSwap
  const leg1 = await getAmountsOut(SUSHISWAP, [TOKENS.USDC, TOKENS.WETH], amount);
  console.log('Leg 1: 1000 USDC →', ethers.formatEther(leg1), 'WETH');
  
  // Leg 2: WETH → USDC_E on Camelot
  const leg2 = await getAmountsOut(CAMELOT, [TOKENS.WETH, TOKENS.USDC_E], leg1);
  console.log('Leg 2:', ethers.formatEther(leg1), 'WETH →', (Number(leg2) / 1e6).toFixed(4), 'USDC_E');
  
  // Leg 3: USDC_E → USDC on SushiSwap
  const leg3 = await getAmountsOut(SUSHISWAP, [TOKENS.USDC_E, TOKENS.USDC], leg2);
  console.log('Leg 3:', (Number(leg2) / 1e6).toFixed(4), 'USDC_E →', (Number(leg3) / 1e6).toFixed(4), 'USDC');
  
  if (leg3 > 0n) {
    const profit = (Number(leg3) - Number(amount)) / 1e6;
    const premium = 0.5; // 0.05% of 1000
    console.log('\n💰 Raw profit:', profit.toFixed(4), 'USDC');
    console.log('💰 After premium:', (profit - premium).toFixed(4), 'USDC');
    console.log(profit > premium ? '✅ PROFITABLE!' : '❌ Not profitable');
  }

  console.log('\n========================================');
  console.log('  Pool Status');
  console.log('========================================');
  
  const pairs = [
    ['USDC→USDC_E', TOKENS.USDC, TOKENS.USDC_E],
    ['USDC_E→USDC', TOKENS.USDC_E, TOKENS.USDC],
    ['USDC→USDT', TOKENS.USDC, TOKENS.USDT],
    ['WETH→USDC', TOKENS.WETH, TOKENS.USDC],
    ['USDC→WETH', TOKENS.USDC, TOKENS.WETH],
  ];
  
  for (const [name, a, b] of pairs) {
    const sushi = await getAmountsOut(SUSHISWAP, [a, b], amount);
    const camelot = await getAmountsOut(CAMELOT, [a, b], amount);
    console.log(name.padEnd(14), 'Sushi:', sushi > 0 ? '✅' : '❌', '  Camelot:', camelot > 0 ? '✅' : '❌');
  }
}

main().catch(console.error);
