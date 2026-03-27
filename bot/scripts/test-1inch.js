// Test 1inch integration
const OneInchService = require('./oneinch');

async function test1inch() {
  console.log('========================================');
  console.log('  Testing 1inch API Integration');
  console.log('========================================\n');

  const oneinch = new OneInchService();

  // Token addresses on Arbitrum
  const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const USDC_E = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';
  const USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
  const DAI = '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1';

  // Test 1: Get quote USDC → USDC.e
  console.log('📊 Test 1: USDC → USDC.e Quote');
  console.log('-----------------------------------');
  const quote1 = await oneinch.getQuote(USDC, USDC_E, '1000000000'); // 1000 USDC
  if (quote1) {
    console.log('1inch says: 1000 USDC →', (Number(quote1.dstAmount) / 1e6).toFixed(6), 'USDC.e');
    console.log('Gas estimate:', quote1.gas);
  } else {
    console.log('Failed to get quote');
  }

  // Test 2: Arbitrage USDC → USDC.e → USDC
  console.log('\n📊 Test 2: Arbitrage USDC → USDC.e → USDC');
  console.log('-----------------------------------');
  const arb = await oneinch.findArbitrage(USDC, USDC_E, '1000000000');
  if (arb) {
    console.log('Initial:', '1000 USDC');
    console.log('After buy:', (Number(arb.buyAmount) / 1e6).toFixed(6), 'USDC.e');
    console.log('After sell:', (Number(arb.sellAmount) / 1e6).toFixed(6), 'USDC');
    console.log('Profit:', (Number(arb.netProfit) / 1e6).toFixed(6), 'USDC');
    console.log('Status:', arb.isProfitable ? '✅ PROFITABLE!' : '❌ Not profitable');
  } else {
    console.log('No arbitrage opportunity found');
  }

  // Test 3: Scan multiple pairs
  console.log('\n📊 Test 3: Scan Multiple Pairs');
  console.log('-----------------------------------');
  const pairs = [
    ['USDC', 'USDC_E'],
    ['USDC', 'USDT'],
    ['USDC', 'DAI'],
    ['WETH', 'USDC'],
  ];
  
  const opportunities = await oneinch.scanPairs(pairs, '1000000000');
  
  if (opportunities.length > 0) {
    console.log(`Found ${opportunities.length} profitable opportunities!`);
    for (const opp of opportunities) {
      console.log(`  ${opp.direction}: ${(Number(opp.netProfit) / 1e6).toFixed(4)} USDC profit`);
    }
  } else {
    console.log('No profitable opportunities found');
  }

  // Test 4: Get WETH price
  console.log('\n📊 Test 4: Get WETH Price in USD');
  console.log('-----------------------------------');
  const wethPrice = await oneinch.getTokenPriceUSD(WETH);
  if (wethPrice) {
    console.log('WETH price: $' + wethPrice.toFixed(2));
  } else {
    console.log('Could not get WETH price');
  }

  console.log('\n========================================');
  console.log('  1inch API Test Complete');
  console.log('========================================');
}

test1inch().catch(console.error);
