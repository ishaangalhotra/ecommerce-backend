const ImageKit = require("imagekit");

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'public_/+DxWFuWSKoxwts4BsW7g1g1dZA=',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'private_vfExL/ayh6TEA0AMeHxn4CwuFsI=',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/phea4zmjs'
});

module.exports = imagekit;