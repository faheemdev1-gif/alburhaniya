const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {Writable} = require('node:stream');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-test-secret';
process.env.MEDIA_STORAGE = 'mongodb';
const app = require('../dist/app').default;
const SiteMedia = require('../dist/models/SiteMedia').default;
const Gallery = require('../dist/models/Gallery').default;
const cloudinary = require('cloudinary').v2;
const records = new Map();
let server, base, png, saved = 0;
const token = jwt.sign({id:'test-admin',role:'admin'}, process.env.JWT_SECRET);
const originalCreate = SiteMedia.create;
const originalFind = SiteMedia.findById;
const originalGalleryCreate = Gallery.create;
const originalGalleryFind=Gallery.findById,originalGalleryUpdate=Gallery.findByIdAndUpdate;
const originalCloudUpload = cloudinary.uploader.upload_stream;

before(async () => {
  png = await sharp({create:{width:80,height:60,channels:3,background:'#ff0099'}}).png().toBuffer();
  SiteMedia.create = async data => {
    const id = (++saved).toString(16).padStart(24,'0');
    records.set(id,data);
    return {id};
  };
  SiteMedia.findById = id => ({select:async () => records.get(id) || null});
  Gallery.create = async data => ({...data,_id:'gallery-test'});
  server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  SiteMedia.create = originalCreate; SiteMedia.findById = originalFind;
  Gallery.create = originalGalleryCreate;Gallery.findById=originalGalleryFind;Gallery.findByIdAndUpdate=originalGalleryUpdate; cloudinary.uploader.upload_stream = originalCloudUpload;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
async function upload(path='/api/media', bytes=png, type='image/png', extra={}, auth=token, field='image') {
  const form = new FormData();
  if(bytes !== null) form.append(field,new Blob([bytes],{type}),'test.png');
  for (const [key,value] of Object.entries(extra)) form.append(key,value);
  return fetch(base+path,{method:'POST',headers:auth ? {Authorization:`Bearer ${auth}`} : {},body:form});
}

test('health identifies the deployed upload contract and both endpoints', async () => {
  const health = await (await fetch(base+'/api/health')).json();
  assert.equal(health.uploadContract,'image-upload-v3');
  assert.equal(health.mediaStorage.provider,'mongodb');
  assert(health.uploads.endpoints.includes('/api/site-content/image'));
});
test('upload endpoints exist and enforce admin authentication before parsing files', async () => {
  for (const path of ['/api/media','/api/site-content/image','/api/gallery']) {
    assert.equal((await upload(path,png,'image/png',{},null)).status,401);
    const userToken = jwt.sign({id:'test-user',role:'user'},process.env.JWT_SECRET);
    assert.equal((await upload(path,png,'image/png',{},userToken)).status,403);
  }
});
test('MongoDB uploads on both routes return full image and thumbnail URLs', async () => {
  for (const path of ['/api/media','/api/site-content/image']) {
    const response = await upload(path);
    assert.equal(response.status,201);
    const data = await response.json();
    assert.equal(data.width,80); assert.equal(data.height,60);
    for (const url of [data.url,data.thumbnailUrl,data.url.replace('/api/media/','/api/site-content/media/')]) {
      const image = await fetch(base+url);
      assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/webp');
      const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
      assert.equal(meta.format,'webp'); assert.equal(meta.width,80);
    }
  }
});
test('JPEG, WebP and GIF uploads are decoded and stored as WebP', async () => {
  for (const format of ['jpeg','webp','gif']) {
    const bytes = await sharp(png)[format]().toBuffer();
    assert.equal((await upload('/api/media',bytes,`image/${format}`)).status,201);
  }
});
test('gallery stores persistent media URLs and preserves its metadata', async () => {
  const response = await upload('/api/gallery',png,'image/png',{title:'Community photo',category:'general',size:'wide',order:'2'});
  assert.equal(response.status,201);
  const item = await response.json();
  assert.equal(item.title,'Community photo'); assert.equal(item.order,2);
  assert.match(item.imageUrl,/^\/api\/media\//); assert.match(item.thumbnailUrl,/\/thumbnail$/);
});
test('invalid gallery fields do not create an image asset', async () => {
  const count = saved;
  assert.equal((await upload('/api/gallery',png,'image/png',{title:'Photo',category:'invalid'})).status,400);
  assert.equal(saved,count);
});
test('missing image, wrong multipart field and unsupported HEIC have actionable errors', async () => {
  assert.equal((await upload('/api/media',null)).status,400);
  assert.equal((await upload('/api/media',png,'image/png',{},token,'file')).status,400);
  const response = await upload('/api/media',png,'image/heic');
  assert.equal(response.status,400); assert.match((await response.json()).message,/HEIC/);
});
test('corrupt images and SVG bytes disguised as PNG are rejected', async () => {
  const count = saved;
  for(const bytes of [Buffer.from('invalid image'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')]) {
    const response = await upload('/api/media',bytes);
    assert.equal(response.status,400); assert.equal((await response.json()).code,'INVALID_IMAGE');
  }
  assert.equal(saved,count);
});
test('upload size setting is read at request time, including after imports', async () => {
  process.env.MAX_FILE_SIZE_MB = '1';
  try {
    const response = await upload('/api/media',Buffer.alloc(1024*1024+1));
    assert.equal(response.status,413); assert.match((await response.json()).message,/1 MB/);
  } finally {delete process.env.MAX_FILE_SIZE_MB;}
});
test('malformed multipart requests return 400 rather than crashing the server', async () => {
  const response = await fetch(base+'/api/media',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'multipart/form-data; boundary=broken'},body:'not a complete multipart body'});
  assert.equal(response.status,400); assert.equal((await response.json()).code,'INVALID_MULTIPART');
});
test('database failures are reported as 503 on both media and gallery routes without leaking internals', async () => {
  const create = SiteMedia.create;
  SiteMedia.create = async () => {throw new Error('mongodb://secret@example:27017 quota exceeded');};
  try {
    for(const path of ['/api/media','/api/gallery']) {
      const response = await upload(path,png,'image/png',{title:'Photo'});
      assert.equal(response.status,503);
      assert(!JSON.stringify(await response.json()).includes('secret'));
    }
  } finally {SiteMedia.create = create;}
});
test('unconfigured Cloudinary rejects uploads clearly and does not silently switch storage', async () => {
  process.env.MEDIA_STORAGE = 'cloudinary';
  try {
    const response = await upload();
    assert.equal(response.status,503); assert.equal((await response.json()).code,'MEDIA_CONFIG');
    assert.equal((await (await fetch(base+'/api/health')).json()).mediaStorage.configured,false);
  } finally {process.env.MEDIA_STORAGE='mongodb';}
});
test('Cloudinary path uploads validated WebP bytes and returns HTTPS CDN URLs', async () => {
  process.env.MEDIA_STORAGE='cloudinary';
  process.env.CLOUDINARY_CLOUD_NAME='test-cloud'; process.env.CLOUDINARY_API_KEY='test-key'; process.env.CLOUDINARY_API_SECRET='test-secret';
  let captured;
  cloudinary.uploader.upload_stream = (options,callback) => new Writable({
    write(chunk,encoding,done){captured=chunk;done();},
    final(done){callback(null,{secure_url:'https://res.cloudinary.com/test-cloud/image/upload/v123/al-burhaniya/photo.webp',public_id:'al-burhaniya/photo',version:123});done();}
  });
  try {
    const count = saved;
    const response = await upload(); assert.equal(response.status,201);
    const data=await response.json();
    assert.match(data.url,/^https:\/\/res.cloudinary.com\//);
    assert.match(data.thumbnailUrl,/c_limit/); assert.match(data.thumbnailUrl,/w_640/);
    assert.equal((await sharp(captured).metadata()).format,'webp'); assert.equal(saved,count);
    // Images stored in MongoDB before switching providers remain accessible.
    assert.equal((await fetch(base+'/api/media/000000000000000000000001')).status,200);
    cloudinary.uploader.upload_stream = (_options,callback) => new Writable({write(c,e,d){d();},final(done){callback({message:'private credential detail'});done();}});
    const failed=await upload(); assert.equal(failed.status,503);
    assert(!JSON.stringify(await failed.json()).includes('private credential detail'));
  } finally {
    cloudinary.uploader.upload_stream=originalCloudUpload;
    process.env.MEDIA_STORAGE='mongodb';
    for(const key of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) delete process.env[key];
  }
});


test('gallery replacement changes the photo on the same record and JSON metadata updates retain its media',async()=>{
  const existing={_id:'gallery-test',title:'Photo',category:'general',size:'normal',order:0,imageUrl:'/api/media/old',thumbnailUrl:'/api/media/old/thumbnail'};
  Gallery.findById=async id=>id==='missing' ? null : {...existing,set(update){Object.assign(this,update);},async validate(){if(this.category==='invalid'){const err=new Error('Bad category');err.name='ValidationError';throw err;}}};
  Gallery.findByIdAndUpdate=async(id,update)=>{Object.assign(existing,update);return {...existing};};
  const form=new FormData();form.append('image',new Blob([png],{type:'image/png'}),'replacement.png');form.append('title','Updated photo');
  const response=await fetch(base+'/api/gallery/gallery-test',{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:form});
  assert.equal(response.status,200);const item=await response.json();
  assert.equal(item._id,'gallery-test');assert.equal(item.title,'Updated photo');assert.notEqual(item.imageUrl,'/api/media/old');assert.match(item.thumbnailUrl,/thumbnail$/);
  const updated=await fetch(base+'/api/gallery/gallery-test',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({order:4})});
  assert.equal(updated.status,200);assert.equal((await updated.json()).imageUrl,item.imageUrl);
  const count=saved;
  const invalid=new FormData();invalid.append('image',new Blob([png],{type:'image/png'}),'photo.png');invalid.append('category','invalid');
  assert.equal((await fetch(base+'/api/gallery/gallery-test',{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:invalid})).status,400);assert.equal(saved,count);
  const missing=await fetch(base+'/api/gallery/missing',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({title:'Photo'})});
  assert.equal(missing.status,404);
});
