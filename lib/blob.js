function isVercel() {
  return !!process.env.VERCEL;
}

function getBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || '';
}

async function blobPut(key, data) {
  const { put } = require('@vercel/blob');
  const json = JSON.stringify(data, null, 2);
  await put(key, json, { access: 'public', addRandomSuffix: false, allowOverwrite: true, token: getBlobToken() });
}

async function blobGet(key) {
  const { list } = require('@vercel/blob');
  try {
    const { blobs } = await list({ prefix: key, limit: 1, token: getBlobToken() });
    if (!blobs.length) return null;
    const resp = await fetch(blobs[0].url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

module.exports = { isVercel, getBlobToken, blobPut, blobGet };
