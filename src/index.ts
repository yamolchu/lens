const { random } = require('user-agents');
const { ethers } = require('ethers');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const { Worker, workerData, isMainThread } = require('worker_threads');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const config = require('../inputs/config.ts');
const csvWriter = createCsvWriter({
  path: './result.csv',
  header: [
    { id: 'proxy', title: 'Proxy' },
    { id: 'privateKey', title: 'PrivateKey' },
  ],
  append: true,
});

function delay(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}
const numThreads = config.numThreads;
const customDelay = config.customDelay;

function parseProxies(filePath: string) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const proxies: string[] = [];

  lines.forEach((line: string) => {
    const proxy = line.trim();
    proxies.push(proxy);
  });

  return proxies;
}

const proxies = parseProxies('./inputs/proxies.txt');
const privateKeys = parseProxies('./inputs/privateKeys.txt');

async function reg(proxy: string, privateKey: string) {
  const headers = {
    'user-agent': random().toString(),
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9,uk;q=0.8',
    'content-type': 'application/json',
    Host: 'waitlist-server.lens.dev',
    origin: 'https://waitlist.lens.xyz',
    'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  };
  const session = axios.create({
    headers: headers,
    httpsAgent:
      config.proxyType === 'http' ? new HttpsProxyAgent(`http://${proxy}`) : new SocksProxyAgent(`socks5://${proxy}`),
  });
  const getNonce = async () => {
    const res = await session.get('https://waitlist-server.lens.dev/auth/nonce');
    return res.data.nonce;
  };

  const provider = new ethers.JsonRpcProvider('https://rpc.ankr.com/eth');
  const wallet = new ethers.Wallet(privateKey);
  wallet.connect(provider);
  const address = wallet.address;
  const time = Date.now();
  const nonce = await getNonce();
  const message = `waitlist.lens.xyz wants you to sign in with your Ethereum account:\n${address}\n\nSign in with Ethereum to the Lens Waitlist app.\n\nURI: https://waitlist.lens.xyz\nVersion: 1\nChain ID: 137\nNonce: ${nonce}\nIssued At: 2023-10-11T09:34:42.458Z`;
  const signature = await wallet.signMessage(message);
  console.log('signature', signature);

  const getToken = async (message: string, nonce: string, signature: string) => {
    const data = { message: message, signature: signature, nonce: nonce };
    const res = await session.post('https://waitlist-server.lens.dev/auth/verify', data);
    console.log('verify', res.data);
    return res.data.token;
  };
  const token = await getToken(message, nonce, signature);
  const res = await session.get('https://waitlist-server.lens.dev/wallet/scan', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  console.log('scan', res.data);

  const resultData = [
    {
      proxy: proxy,
      privateKey: privateKey,
    },
  ];
  await csvWriter
    .writeRecords(resultData)
    .then(() => {
      console.log('CSV file has been saved.');
    })
    .catch((error: any) => {
      console.error(error);
    });
}

function regRecursive(proxies: any, privateKeys: any, index = 0, numThreads = 4) {
  if (index >= proxies.length) {
    return;
  }

  const worker = new Worker(__filename, {
    workerData: { proxy: proxies[index], privateKey: privateKeys[index] },
  });
  worker.on('message', (message: any) => {
    console.log(message);
  });
  worker.on('error', (error: any) => {
    console.error(error);
  });
  worker.on('exit', (code: any) => {
    if (code !== 0) {
      console.error(`Thread Exit ${code}`);
    }
    regRecursive(proxies, privateKeys, index + numThreads, numThreads);
  });
}
const main = async () => {
  if (isMainThread) {
    for (let i = 0; i < numThreads; i++) {
      await delay(customDelay);
      regRecursive(proxies, privateKeys, i, numThreads);
    }
  } else {
    await delay(customDelay);
    const { proxy, privateKey } = workerData;
    reg(proxy, privateKey);
  }
};
main();
