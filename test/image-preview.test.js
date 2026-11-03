'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('image sources use browser MIME types and refuse incomplete previews', async () => {
  const { imageSource, imageMime } = await import('../ui/src/lib/image-preview.mjs');
  assert.equal(imageMime('PHOTO.JPEG'), 'image/jpeg'); assert.equal(imageMime('favicon.ico'), 'image/x-icon');
  assert.equal(imageSource({ rel: 'a.jpg', content: '', base64: 'YWJj' }), 'data:image/jpeg;base64,YWJj');
  assert.equal(imageSource({ rel: 'a.png', content: '', base64: 'YWJj', truncated: true }), null);
  assert.equal(imageSource({ rel: 'a.png', content: '' }), null);
  assert.equal(imageSource({ rel: 'index.html', content: '<script/>' }), null);
  assert.equal(imageSource({ rel: 'vector.svg', content: '<svg/>' }), 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
});

test('fit scales respect both dimensions without upscaling small images', async () => {
  const { fitImageScale } = await import('../ui/src/lib/image-preview.mjs');
  assert.equal(fitImageScale(1600, 1000, 832, 532), .5);
  assert.equal(fitImageScale(100, 100, 832, 532), 1);
  assert.equal(fitImageScale(0, 100, 832, 532), 1);
  assert.equal(fitImageScale(100, 100, 0, 0), 1);
  assert.equal(fitImageScale(2000, 10000, 832, 532), .05);
});

test('Markdown images resolve beside their document and reject escapes or unsupported schemes', async () => {
  const { projectImagePath } = await import('../ui/src/lib/image-preview.mjs');
  assert.equal(projectImagePath('../images/screen%20shot.png', '/work/project', 'docs/README.md'), 'images/screen shot.png');
  assert.equal(projectImagePath('/work/project/assets/logo.svg', '/work/project'), 'assets/logo.svg');
  assert.equal(projectImagePath('assets/photo.png', '/work/project'), 'assets/photo.png');
  for (const source of ['../../secret.png', '/work/other/secret.png', '/work/project-other/secret.png', 'javascript:alert(1)', 'https://site.test/a.png', '//site.test/a.png', 'file:///etc/picture.png', '%00.png', 'bad%ZZ.png']) assert.equal(projectImagePath(source, '/work/project'), null, source);
});
