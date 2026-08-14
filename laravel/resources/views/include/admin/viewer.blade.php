{{-- A shared overlay for "View": a deposit screenshot on /admin/deposits, the
     payout details on /admin/withdrawals. Deliberately not a Bootstrap modal -
     which major version the admin bundle ships is not obvious, and this needs
     no plugin at all. Any button with data-img (image) or data-html (markup)
     opens it. --}}
<div class="tl-viewer" id="tl_viewer" hidden>
    <div class="tl-viewer-box" role="dialog" aria-modal="true" aria-labelledby="tl_viewer_title">
        <div class="tl-viewer-head">
            <strong id="tl_viewer_title"></strong>
            <button type="button" class="tl-viewer-x" id="tl_viewer_close" aria-label="Close">
                <i class="mdi mdi-close"></i>
            </button>
        </div>
        <div class="tl-viewer-body" id="tl_viewer_body"></div>
    </div>
</div>
<script>
    (function () {
        var box = document.getElementById('tl_viewer');
        var body = document.getElementById('tl_viewer_body');
        var title = document.getElementById('tl_viewer_title');

        function close() { box.hidden = true; body.innerHTML = ''; }

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.tl-view-btn');
            if (btn) {
                title.innerHTML = btn.dataset.title || 'Details';
                // data-img is a URL we built; data-html is escaped in the blade
                body.innerHTML = btn.dataset.img
                    ? '<a href="' + btn.dataset.img + '" target="_blank" rel="noopener"><img src="' + btn.dataset.img + '" alt="uploaded screenshot"></a>'
                    : (btn.dataset.html || '');
                box.hidden = false;
                return;
            }
            if (e.target === box || e.target.closest('#tl_viewer_close')) close();
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    })();
</script>
