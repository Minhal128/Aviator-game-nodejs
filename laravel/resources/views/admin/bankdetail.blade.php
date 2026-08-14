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
        <p class="text-muted" style="margin-top:-.5rem;">Players see every UPI and bank account listed here on the deposit page. Add as many as you need.</p>

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
                        <h4 class="card-title"><i class="mdi mdi-bank-transfer me-1"></i> Bank accounts</h4>

                        @forelse ($banks as $bank)
                            <div class="border rounded p-3 mb-3">
                                <form class="forms-sample tl-rail-form" data-rail="bank">
                                    @csrf
                                    <input type="hidden" name="id" value="{{ $bank->id }}">
                                    <input type="hidden" name="rail" value="bank">
                                    <div class="form-group">
                                        <label>Bank name</label>
                                        <input type="text" class="form-control" name="bank_name" value="{{ $bank->bank_name }}">
                                    </div>
                                    <div class="form-group">
                                        <label>Account number</label>
                                        <input type="text" class="form-control" name="account_no" value="{{ $bank->account_no }}">
                                    </div>
                                    <div class="form-group">
                                        <label>Account holder name</label>
                                        <input type="text" class="form-control" name="holdername" value="{{ $bank->account_holder_name }}">
                                    </div>
                                    <div class="form-group">
                                        <label>IFSC code</label>
                                        <input type="text" class="form-control" name="ifsccode" value="{{ $bank->ifsc_code }}">
                                    </div>
                                    <button type="submit" class="btn btn-gradient-primary me-2">Save</button>
                                    <button type="button" class="btn btn-outline-danger tl-rail-delete" data-id="{{ $bank->id }}" data-rail="bank">Delete</button>
                                </form>
                            </div>
                        @empty
                            <p class="text-muted">No bank account yet.</p>
                        @endforelse

                        <div class="border rounded p-3 border-dashed">
                            <h5 class="mb-3">Add bank</h5>
                            <form class="forms-sample tl-rail-form" data-rail="bank">
                                @csrf
                                <input type="hidden" name="id" value="0">
                                <input type="hidden" name="rail" value="bank">
                                <div class="form-group">
                                    <label>Bank name</label>
                                    <input type="text" class="form-control" name="bank_name" placeholder="Bank name" required>
                                </div>
                                <div class="form-group">
                                    <label>Account number</label>
                                    <input type="text" class="form-control" name="account_no" placeholder="Account number" required>
                                </div>
                                <div class="form-group">
                                    <label>Account holder name</label>
                                    <input type="text" class="form-control" name="holdername" placeholder="Account holder name">
                                </div>
                                <div class="form-group">
                                    <label>IFSC code</label>
                                    <input type="text" class="form-control" name="ifsccode" placeholder="IFSC code">
                                </div>
                                <button type="submit" class="btn btn-gradient-primary">Add bank</button>
                            </form>
                        </div>
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
        $(".tl-rail-form").each(function () {
            var $form = $(this);
            $form.on('submit', function (e) { e.preventDefault(); });
            $form.validate({
                submitHandler: function (form) {
                    apex("POST", "{{ url('admin/api/bankdetail') }}", new FormData(form), form,
                        "/admin/bank-detail", "#");
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
