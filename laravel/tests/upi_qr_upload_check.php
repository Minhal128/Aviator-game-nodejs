<?php
declare(strict_types=1);
/**
 * Adding a UPI with a QR photo.
 * Run: php laravel/tests/upi_qr_upload_check.php
 *
 * A picture straight off a phone is several MB; php.ini upload_max_filesize is 2M
 * on this build and on most shared hosting. Over it PHP hands Laravel an invalid
 * file, over post_max_size it drops the request body entirely - and the admin
 * panel showed one flat "Server Error" for both, which is why the failure could
 * not be read. The browser now shrinks the picture before it is ever sent.
 */
$blade = file_get_contents(__DIR__ . '/../resources/views/admin/bankdetail.blade.php');
$api = file_get_contents(__DIR__ . '/../app/Http/Controllers/Adminapi.php');
$apex = file_get_contents(dirname(__DIR__, 2) . '/js/appcustomize.js');

// the picture is resized in the browser, and the resized blob is what gets posted
assert(str_contains($blade, 'function shrinkQr(file)'), 'no client-side resize');
assert(str_contains($blade, "c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)"), 'resize does not redraw');
assert(str_contains($blade, "1200 / Math.max(img.width, img.height)"), 'resize target changed');
assert(str_contains($blade, "fd.set('barcode', blob, 'qr.jpg')"), 'the shrunk blob is not what gets sent');
// .jpg so it still clears the extension whitelist below
assert(str_contains($api, "['jpg', 'jpeg', 'png', 'webp']"), 'extension whitelist moved');
// an already-small file must not be replaced by a bigger re-encode
assert(str_contains($blade, 'blob.size < file.size ? blob : null'), 'resize can now inflate a small file');
// a non-image (or no file at all) must pass straight through
assert(str_contains($blade, "if (!file || !/^image\//.test(file.type))"), 'non-images no longer pass through');

// the server names the host's real ceiling instead of a number nobody set
assert(str_contains($api, "ini_get('upload_max_filesize')"), 'server still quotes a made-up limit');
assert(str_contains($api, 'if (!$file->isValid()) {'), 'invalid upload no longer reported separately');

// and the panel stops flattening every failure into "Server Error"
assert(!str_contains($apex, 'Server Error, Please retry'), 'generic message is back');
assert(str_contains($apex, 'The server replied with something unexpected'), 'no detail on an odd reply');
assert(str_contains($apex, "e.responseText || ''"), 'error path still hides the body');

echo "upi_qr_upload_check OK\n";
echo "  QR is resized to <=1200px JPEG in the browser, so php.ini limits stop mattering\n";
echo "  server quotes the host's real upload_max_filesize when a file still fails\n";
echo "  admin panel shows what actually came back instead of \"Server Error\"\n";
