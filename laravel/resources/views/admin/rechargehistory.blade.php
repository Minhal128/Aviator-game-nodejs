@extends('Layout.tower')
@section('css')
@endsection
@section('content')
    <div class="content-wrapper">
        <div class="page-header">
            <h3 class="page-title">
                <span class="page-title-icon bg-gradient-primary text-white me-2">
                    <i class="mdi mdi-home"></i>
                </span> Deposits
            </h3>
        </div>
        <div class="row">
            <div class="col-lg-12 grid-margin stretch-card">
                <div class="card">
                    <div class="card-body">
                        <h4 class="card-title">Deposit requests</h4>
                        <div class="table-responsive">
                        <table class="table table-bordered">
                            <thead>
                                <tr>
                                    <th>Sr.No</th>
                                    <th>User id</th>
                                    <th>Name</th>
                                    <th>Transaction No.</th>
                                    <th>Amount</th>
                                    <th>Proof</th>
                                    <th>Status</th>
                                    <th>Created</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                @if (count($history) > 0)
                                    @foreach ($history as $history)
                                        <tr>
                                            <td>{{ $loop->iteration }}</td>
                                            <td>{{ appvalidate($history->userid) }}</td>
                                            <td>{{ appvalidate(userdetail($history->userid, 'name')) }}</td>
                                            <td>{{ appvalidate($history->transactionno) }}</td>
                                            <td>₹{{ appvalidate(number_format($history->amount, 2)) }}</td>
                                            <td>
                                                @if ($history->proof)
                                                    <button type="button" class="btn btn-sm btn-outline-light tl-view-btn"
                                                        data-img="{{ url('admin/proof/' . $history->id) }}"
                                                        data-title="Deposit {{ $history->id }} &middot; {{ appvalidate(userdetail($history->userid, 'name')) }} &middot; &#8377;{{ number_format($history->amount, 2) }}">
                                                        <i class="mdi mdi-image-search-outline"></i> View
                                                    </button>
                                                @else
                                                    <span class="text-muted">none</span>
                                                @endif
                                            </td>
                                            <td><label
                                                    class="badge badge-{{ status($history->status, 'recharge')['color'] }}">{{ status($history->status, 'recharge')['name'] }}</label>
                                            </td>
                                            <td>{{ dformat($history->created_at, 'd-m-Y') }}</td>
                                            <td>
                                                @if ($history->status == 0)
                                                    <button class="btn btn-sm btn-success"
                                                        onclick="rechargeapprove('{{$history->userid}}','{{ $history->id }}','{{ $history->amount }}',this)">approve</button>
                                                    <button class="btn btn-sm btn-danger"
                                                        onclick="rechargecancel('{{$history->userid}}','{{ $history->id }}','{{ $history->amount }}',this)">Cancel</button>
                                                @else
                                                    <button
                                                        class="btn btn-sm btn-{{ status($history->status, 'recharge')['color'] }}">{{ status($history->status, 'recharge')['name'] }}</button>
                                                @endif
                                            </td>
                                        </tr>
                                    @endforeach
                                @else
                                    <tr>
                                        <td colspan="13" class="text-center"> No deposit requests yet.</td>
                                    </tr>
                                @endif
                            </tbody>
                        </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- content-wrapper ends -->
@include('include.admin.viewer')
@endsection

@section('js')
    <script>
        function rechargeapprove(userid,id,amount,thisc) {
            let form = new FormData();
            form.append('id', id);
            form.append('userid', userid);
            form.append('amount', amount);
            form.append('_token', '{{ csrf_token() }}');
            apex("POST", "{{ url('admin/api/recharge/success') }}", form, '', "/admin/deposits", "#");
        }

        function rechargecancel(userid,id,amount,thisc) {
            let form = new FormData();
            form.append('id', id);
            form.append('userid', userid);
            form.append('amount', amount);
            form.append('_token', '{{ csrf_token() }}');
            apex("POST", "{{ url('admin/api/recharge/cancel') }}", form, '', "/admin/deposits", "#");
        }
    </script>
@endsection
