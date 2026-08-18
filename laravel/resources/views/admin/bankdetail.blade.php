@extends('Layout.tower')
@section('css')
@endsection

@section('content')
    <div class="content-wrapper">
        <div class="page-header">
            <h3 class="page-title">
                <span class="page-title-icon bg-gradient-primary text-white me-2">
                    <i class="mdi mdi-bank"></i>
                </span> Bank rails
            </h3>
        </div>
        <p class="text-muted" style="margin-top:-.5rem;">Deposits are accepted through UPI only. Add as many UPI accounts as you need.</p>

        <div class="row">
            <div class="col-lg-6 col-12 grid-margin stretch-card">
                <div class="card">
                    <div class="card-body">
                        <h4 class="card-title"><i class="mdi mdi-cellphone-link me-1"></i> UPI accounts</h4>

                        @forelse ($upis as $bank)
                            <div class="border rounded p-3 mb-3">
                                <form class="forms-sample tl-rail-form" data-rail="upi">
                                    @csrf
                                    <input type="hidden" name="id" value="{{ $bank->id }}">
                                    <input type="hidden" name="rail" value="upi">
                                    <div class="form-group">
                                        <label>UPI ID</label>
                                        <input type="text" class="form-control" name="upi_id" placeholder="name@bank" value="{{ $bank->upi_id }}">
                                    </div>
                                    <div class="form-group">
                                        <label>Name on the UPI account</label>
                                        <input type="text" class="form-control" name="holdername" value="{{ $bank->account_holder_name }}">
                                    </div>
                                    <div class="form-group">
                                        <label>Mobile number</label>
                                        <input type="text" class="form-control" name="mobile_no" value="{{ $bank->mobile_no }}">
                                    </div>
                                    <div class="form-group">
                                        <label>QR code</label>
                                        <input type="file" class="form-control" name="barcode" accept="image/png,image/jpeg,image/webp">
                                        <small class="text-muted">Leave empty to keep the current one.</small>
                                    </div>
                                    @if ($bank->barcode != '')
                                        <a href="{{ $bank->barcode }}" target="_blank" rel="noopener" class="d-inline-block mb-3">
                                            <img src="{{ $bank->barcode }}" alt="QR" class="img-fluid tl-qr-preview">
                                        </a>
                                    @endif
                                    <button type="submit" class="btn btn-gradient-primary me-2">Save</button>
                                    <button type="button" class="btn btn-outline-danger tl-rail-delete" data-id="{{ $bank->id }}" data-rail="upi">Delete</button>
                                </form>
                            </div>
                        @empty
                            <p class="text-muted">No UPI yet.</p>
                        @endforelse

                        <div class="border rounded p-3 border-dashed">
                            <h5 class="mb-3">Add UPI</h5>
                            <form class="forms-sample tl-rail-form" data-rail="upi">
                                @csrf
                                <input type="hidden" name="id" value="0">
                                <input type="hidden" name="rail" value="upi">
                                <div class="form-group">
                                    <label>UPI ID</label>
                                    <input type="text" class="form-control" name="upi_id" placeholder="name@bank" required>
                                </div>
                                <div class="form-group">
                                    <label>Name on the UPI account</label>
                                    <input type="text" class="form-control" name="holdername" placeholder="Account holder name">
                                </div>
                                <div class="form-group">
                                    <label>Mobile number</label>
                                    <input type="text" class="form-control" name="mobile_no" placeholder="10 digits">
                                </div>
                                <div class="form-group">
                                    <label>QR code</label>
                                    <input type="file" class="form-control" name="barcode" accept="image/png,image/jpeg,image/webp">
                                </div>
                                <button type="submit" class="btn btn-gradient-primary">Add UPI</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-lg-6 col-12 grid-margin stretch-card">
                <div class="card">
                    <div class="card-body">
                        <h4 class="card-title"><i class="mdi mdi-bank-off me-1"></i> Net Banking disabled</h4>
                        <p class="text-muted mb-0">Bank-transfer deposits cannot be configured or submitted. Players can deposit through UPI only.</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-6 col-12 grid-margin stretch-card">
                <div class="card">
                    <div class="card-body">
                        <h4 class="card-title"><i class="mdi mdi-tune me-1"></i> Limits</h4>
                        <p class="text-muted" style="font-size:.85rem;">The cashier refuses anything below these, on the page and on the server.</p>
                        <form class="forms-sample" id="limits_form">
                            @csrf
                            <div class="form-group">
                                <label for="min_recharge">Minimum deposit</label>
                                <input type="number" min="1" step="1" class="form-control" id="min_recharge"
                                    name="min_recharge" value="{{ $minDeposit }}">
                            </div>
                            <div class="form-group">
                                <label>Maximum deposit</label>
                                <input type="text" class="form-control" value="₹1,00,000" disabled>
                                <small class="text-muted">Fixed server-side limit.</small>
                            </div>
                            <div class="form-group">
                                <label for="min_withdrawal">Minimum withdrawal</label>
                                <input type="number" min="1" step="1" class="form-control" id="min_withdrawal"
                                    name="min_withdrawal" value="{{ $minWithdrawal }}">
                            </div>
                            <button type="submit" class="btn btn-gradient-primary me-2">Save limits</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection

@section('js')
    <script>
        /**
         * A QR photo straight off a phone is 2-6 MB, and shared hosting caps a single
         * upload at php.ini upload_max_filesize - 2M on this build. Over that limit PHP
         * throws the file away before Laravel sees it, and over post_max_size it throws
         * the whole request away, token and all, which is where "Oops! Server Error"
         * came from. Redrawing the picture at most 1200px wide as JPEG lands it around
         * 100 KB, so the upload stops depending on the host's php.ini at all. A QR reads
         * fine at that size - it is a few hundred modules at most.
         */
        function shrinkQr(file) {
            if (!file || !/^image\//.test(file.type)) return $.Deferred().resolve(null).promise();
            var d = $.Deferred();
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
                var c = document.createElement('canvas');
                c.width = Math.round(img.width * scale);
                c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                c.toBlob(function (blob) {
                    // keep the original if shrinking made it bigger (already-small PNGs)
                    d.resolve(blob && blob.size < file.size ? blob : null);
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function () { URL.revokeObjectURL(url); d.resolve(null); };
            img.src = url;
            return d.promise();
        }

        $(".tl-rail-form").each(function () {
            var $form = $(this);
            $form.on('submit', function (e) { e.preventDefault(); });
            $form.validate({
                submitHandler: function (form) {
                    var fd = new FormData(form);
                    var input = form.querySelector('input[type=file][name=barcode]');
                    shrinkQr(input && input.files[0]).then(function (blob) {
                        if (blob) fd.set('barcode', blob, 'qr.jpg');
                        apex("POST", "{{ url('admin/api/bankdetail') }}", fd, form,
                            "/admin/bank-detail", "#");
                    });
                }
            });
        });

        $(".tl-rail-delete").on('click', function () {
            var id = $(this).data('id');
            var rail = $(this).data('rail');
            var fd = new FormData();
            fd.append('_token', '{{ csrf_token() }}');
            fd.append('id', id);
            fd.append('rail', rail);
            apex("POST", "{{ url('admin/api/bankdetail/delete') }}", fd, '', "/admin/bank-detail", "#");
        });

        $("#limits_form").on('submit', function (e) { e.preventDefault(); });
        $("#limits_form").validate({
            submitHandler: function (form) {
                apex("POST", "{{ url('admin/api/limits') }}", new FormData(form), form,
                    "/admin/bank-detail", "#");
            }
        });
    </script>
@endsection
