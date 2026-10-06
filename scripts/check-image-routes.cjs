// Only unauthenticated probes: no image or website data is written.
async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/check-image-routes.cjs https://YOUR-BACKEND/api');
  const url = new URL(input.replace(/\/+$/,''));
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Provide a plain backend URL without credentials or query parameters.');
  const apiBase = url.href.replace(/\/+$/,'').replace(/\/api$/,'')+'/api';
  const health = await fetch(apiBase+'/health',{signal:AbortSignal.timeout(90000)});
  if(!health.ok) throw new Error(`Health endpoint returned ${health.status}. Check the backend URL.`);
  const data = await health.json();
  console.log('Upload contract:',data.uploadContract || 'missing (older backend)');
  console.log('Image storage:',data.mediaStorage || 'not reported');
  let failed = data.uploadContract !== 'image-upload-v3';
  for (const endpoint of ['/media','/site-content/image','/gallery']) {
    const response = await fetch(apiBase+endpoint,{method:'POST',signal:AbortSignal.timeout(15000)});
    console.log(`POST ${endpoint}: ${response.status}${response.status === 401 ? ' (route exists; login required)' : ' (expected 401)'}`);
    if(response.status !== 401) failed=true;
  }
  if(failed) {process.exitCode=1;console.log('Deploy the updated server and verify the API URL before uploading.');}
}
main().catch(err => {console.error(err.message);process.exitCode=1;});
