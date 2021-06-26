import ethers from 'ethers';
import express from 'express';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';

const app = express();
dotenv.config();

const data = {
  WBNB: process.env.WBNB_CONTRACT, //wbnb

  factory: process.env.FACTORY,  //PancakeSwap V2 factory

  router: process.env.ROUTER, //PancakeSwap V2 router

  recipient: process.env.YOUR_ADDRESS, //your wallet address,

  /** COMMON CONFIGURATION */

  gasPrice : ethers.utils.parseUnits(`${process.env.COMMON_GWEI}`, 'gwei'), //in gwei
  
  gasLimit : process.env.COMMON_GAS_LIMIT, //at least 21000

  autoApprove : process.env.COMMON_AUTO_APPROVE, // Enable auto approve of a token to be allowed to sell it.

  /** SNIPE BOT CONFIGURATION */
  
  to_PURCHASE: process.env.SNIPE_BOT_TO_PURCHASE, // token that you will purchase = BUSD for test '0xe9e7cea3dedca5984780bafc599bd69add087d56'

  AMOUNT_OF_WBNB : process.env.SNIPE_BOT_AMOUNT_OF_WBNB, // how much you want to buy in WBNB

  minBnb : process.env.SNIPE_BOT_MIN_LIQUIDITY_ADDED, //min liquidity added

  enableAutoSell : process.env.SNIPE_BOT_SELL_AFTER_BUY, // Auto sell after buy

  profitCoefficient : parseFloat(process.env.SNIPE_BOT_TAKE_PROFIT), // Profit expected before sell (in example : you bought for 1BNB of a token but expect 2 BNB, then you should set it at 2)

  sell_only : process.env.SNIPE_BOT_SELL_ONLY, // ONLY SELLING

  balance_purcent : process.env.SNIPE_BOT_SELL_BALANCE_PURCENT // Purcentage of balance to sell
}

let initialLiquidityDetected = false;
let jmlBnb = 0;

const bscMainnetUrl = 'https://bsc-dataseed1.ninicoin.io/' //https://bsc-dataseed1.defibit.io/ https://bsc-dataseed.binance.org/
//const bscMainnetUrl = 'https://data-seed-prebsc-1-s1.binance.org:8545/' // WHEN TESTNET
const wss = 'wss://bsc-ws-node.nariox.org:443';
const mnemonic = process.env.YOUR_MNEMONIC //your memonic;
const tokenIn = data.WBNB;
const tokenOut = data.to_PURCHASE;
//const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl)
const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet.fromMnemonic(mnemonic);
const account = wallet.connect(provider);


const factory = new ethers.Contract(
  data.factory,
  [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
  ],
  account
);

const router = new ethers.Contract(
  data.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
  ],
  account
);

const erc = new ethers.Contract(
  data.WBNB,
  [
    'function balanceOf(address tokenOwner) external view returns (uint256)',
    'function approve(address spender, uint amount) public returns(bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',

  ],
  account
);  

const tokenOutContract = new ethers.Contract(
  data.to_PURCHASE,
  [
  'function balanceOf(address tokenOwner) external view returns (uint256)',
  'function approve(address spender, uint amount) public returns(bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  ],
  account
);  

const beforeRun = async () => {
  if(parseInt(data.autoApprove) !== 0){
    console.log(chalk.yellow.inverse(`Checking if WBNB is already approved...`));
    let isWBNBApproved = false;
    const isWBNBApprovedTx = await erc.allowance(
      data.recipient,
      data.router
    );
    isWBNBApproved = isWBNBApprovedTx.toString() > 0 ? true : false;
    if(isWBNBApproved === false) {
      console.log(chalk.yellow.inverse(`WBNB was not approved...`));
      console.log(chalk.yellow.inverse(`Approving WBNB...`));
      const txApprove = await erc.approve(
        data.router,
        ethers.constants.MaxUint256
      );
      const txApproveReceipt = await txApprove.wait();
      console.log(chalk.green.inverse(`Transaction APPROVE receipt : https://www.bscscan.com/tx/${txApproveReceipt.transactionHash}`));
    }
    console.log(chalk.green.inverse(`WBNB was already approved...`));
    console.log(chalk.green.inverse(`Continuing the process...`));

    if(parseInt(data.enableAutoSell) !== 0){
      console.log(chalk.yellow.inverse(`Checking if token is already approved...`));
      let isTokenSwapApproved
      const isTokenSwapApprovedTx = await tokenOutContract.allowance(
        data.recipient,
        data.router
      );
      isTokenSwapApproved = isTokenSwapApprovedTx.toString() > 0 ? true : false;
      if(isTokenSwapApproved === false) {
        console.log(chalk.yellow.inverse(`Token was not approved...`));
        console.log(chalk.yellow.inverse(`Approving token...`));
        const txApprove = await tokenOutContract.approve(
          data.router,
          ethers.constants.MaxUint256
        );
        const txApproveReceipt = await txApprove.wait();
        console.log(chalk.green.inverse(`Transaction APPROVE receipt : https://www.bscscan.com/tx/${txApproveReceipt.transactionHash}`));
      }
      console.log(chalk.green.inverse(`Token was already approved...`));
      console.log(chalk.green.inverse(`Continuing the process...`));
    } 
  }
  setTimeout(() => run(), 3000);
}
const run = async () => {
  if( parseInt(data.sell_only) !== 0 ){
    await beforeSellAction();
  } else {
    await checkLiq();
  }
}

let checkLiq = async() => {
  const pairAddressx = await factory.getPair(tokenIn, tokenOut);
  console.log(chalk.blue.inverse(`Liquidity Pool Address: ${pairAddressx}`));
  if (pairAddressx !== null && pairAddressx !== undefined) {
    // console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
    if ( pairAddressx.toString().indexOf('0x0000000000000') > -1 ) {
      console.log(chalk.cyan.inverse(`Liquidity Pool Address :  ${pairAddressx} not detected. Auto restart`));
      return await run();
    }
  }
  const pairBNBvalue = await erc.balanceOf(pairAddressx); 
  jmlBnb = await ethers.utils.formatEther(pairBNBvalue);
  console.log(chalk.cyan.inverse(`Current token value in BNB : ${jmlBnb}`));

  if ( jmlBnb > data.minBnb ) {
      setTimeout(() => buyAction(), 3000);
  } else {
      initialLiquidityDetected = false;
      console.log(chalk.blue.inverse('Run again...'));
      return await run();
    }
}

let buyAction = async() => {
  if(initialLiquidityDetected === true) {
    console.log('not buy cause already buy');
      return null;
  }
  try{
    initialLiquidityDetected = true;

    let amountOutMin = 0;
    //We buy x amount of the new token for our wbnb
    const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_WBNB}`, 'ether');
  
    console.log(
      chalk.green.inverse(`Start to buy \n`)
      +
      `Buying Token
      =================
      tokenIn: ${(amountIn * 1e-18).toString()} ${tokenIn} (BNB)
      tokenOut: ${amountOutMin.toString()} ${tokenOut}
    `);
    
    console.log('Processing Transaction.....');
    console.log(chalk.yellow(`amountIn: ${(amountIn * 1e-18)} ${tokenIn} (BNB)`));
    console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`));
    console.log(chalk.yellow(`tokenIn: ${tokenIn}`));
    console.log(chalk.yellow(`tokenOut: ${tokenOut}`));
    console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
    console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
    console.log(chalk.yellow(`data.gasPrice: ${data.gasPrice}`));

    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      amountIn,
      amountOutMin,
      [tokenIn, tokenOut],
      data.recipient,
      Date.now() + 1000 * 60 * 5, //5 minutes
      {
        'gasLimit': data.gasLimit,
        'gasPrice': data.gasPrice,
          'nonce' : null //set you want buy at where position in blocks
    });
    
    const receipt = await tx.wait(); 
    console.log(chalk.green.inverse(`Transaction BUY receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`));
    if(parseInt(data.enableAutoSell) !== 0){
      setTimeout(() => beforeSellAction(), 3000);
    } else {
      setTimeout(() => {process.exit()},2000);
    }

  }catch(err){
    let error = JSON.parse(JSON.stringify(err));
      console.log(`Error caused by : 
      {
      reason : ${error.reason},
      transactionHash : ${error.transactionHash}
      message : Issue when buying, might be because you didnt approve WBNB, you dont have enough WBNB or not enough BNB to proceed transaction.
      }`);
      console.log(error);

      inquirer.prompt([
  {
    type: 'confirm',
    name: 'runAgain',
    message: 'Do you want to run again thi bot?',
  },
])
.then(answers => {
  if(answers.runAgain === true){
    console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
    console.log('Run again');
    console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
    initialLiquidityDetected = false;
    run();
  }else{
    process.exit();
  }

});

  }
} 

let beforeSellAction = async() => {
  if(parseInt(data.enableAutoSell) !== 0){
  // Pourcent de la balance a vendre
  let purcentToSell = parseFloat(data.balance_purcent/100);

  // Recuperation de la balance
  const txBalanceOf = await tokenOutContract.balanceOf(
      data.recipient
  );
  // Montant actuel de token
  let currentTokenAmount = txBalanceOf;
  // Calcul du montant de token a vendre
  let amountTokenToSell = ethers.BigNumber.from((currentTokenAmount.toString() * purcentToSell).toFixed());
  if ( amountTokenToSell >= currentTokenAmount.toString() ){
    amountTokenToSell = currentTokenAmount.toString();
  }

  const currentAmountBeforeSell = await router.getAmountsOut(amountTokenToSell, [tokenOut, tokenIn]);
  setTimeout(() => sellAction(currentAmountBeforeSell[1], amountTokenToSell), 3000);
  }
}

let sellAction = async(currentAmountBeforeSell , amountTokenToSell) => {
  const currentAmountOut = await router.getAmountsOut(amountTokenToSell, [tokenOut, tokenIn]);
  let minAmountBeforeSell = await ethers.BigNumber.from((currentAmountBeforeSell.toString() * data.profitCoefficient).toFixed());

  let isWinningSell = currentAmountOut[1].gt(minAmountBeforeSell);

  let curValueOut = await ethers.utils.formatEther(currentAmountOut[1])
  let expectedValueOut = await ethers.utils.formatEther(minAmountBeforeSell)

  if( isWinningSell === false) {
    console.log(chalk.red.inverse('Current token value : ' + curValueOut + ` (BNB) < ` + expectedValueOut + ' (BNB) (Price you want to sell at) '+ `\n`));
    setTimeout(() => sellAction(currentAmountBeforeSell, amountTokenToSell), 3000);
  }else {
    console.log(chalk.green.inverse('Current Token Value : ' + curValueOut  + ` (BNB) > ` + expectedValueOut + ` (BNB)\n`));
    console.log('ready to sell');
    try{
      initialLiquidityDetected = true;

      let amountOutMin = 0;
    
      console.log(
        chalk.red.inverse(`Start to sell \n`)
        +
        `Selling Token
        =================
      `);
      
      console.log('Processing Transaction.....');
      console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
      console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
      console.log(chalk.yellow(`data.gasPrice: ${data.gasPrice}`));

      console.log('Balance of : ' + amountTokenToSell);
       const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens( 
        amountTokenToSell,
        amountOutMin,
        [tokenOut, tokenIn],
        data.recipient,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
          'gasLimit': data.gasLimit,
          'gasPrice': data.gasPrice,
            'nonce' : null //set you want buy at where position in blocks
      });
      
      const receipt = await tx.wait();
      console.log(chalk.green.inverse(`Transaction SELL receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`));
      setTimeout(() => {process.exit()},2000);
    }catch(err){
      let error = JSON.parse(JSON.stringify(err));
        console.log(`Error caused by : 
        {
        reason : ${error.reason},
        transactionHash : ${error.transactionHash}
        message : Issue when selling token, it might be because you didnt approve Token, or not enough BNB to proceed transaction.
        }`);
        console.log(error);

        inquirer.prompt([
    {
      type: 'confirm',
      name: 'runAgain',
      message: 'Do you want to run again thi bot?',
    },
  ])
  .then(answers => {
    if(answers.runAgain === true){
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      console.log('Run again');
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      initialLiquidityDetected = false;
      run();
    }else{
      process.exit();
    }

  });

    }
  }
}

beforeRun();

const PORT = 5000;

app.listen(PORT, console.log(chalk.yellow(`Listening for Liquidity Addition to token ${data.to_PURCHASE}`)));
