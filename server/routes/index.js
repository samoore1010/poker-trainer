'use strict';
// Every feature registers its routes here. To add one: create routes/<feature>.js exporting
// (router, ctx) => { router.get/post(path, [opts], handler) } and add it to this list.
module.exports = [
  require('./system'),
  require('./voice'),
  require('./cards'),
  require('./agent'),
];
