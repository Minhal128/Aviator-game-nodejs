function withdraw(id, min_withdraw_amount) {
    $("#min_withdraw_amount").val(min_withdraw_amount);
    $(".error").hide();

    $("#amount").val('');
    $("#account_no").val('');
    $("#account_holder_name").val('');
    $("#bankname").val('');
    $("#ifsc_code").val('');
    $("#upi_id").val('');
    $("#payment_gateway_type").val(id);

    const bankFields = $("#account_div, #acc_holder_name_div, #bank_name_div, #ifsc_code_div");
    if (id == 3) {
        bankFields.hide();
        $("#upi_id_div").show();
    } else {
        bankFields.show();
        $("#upi_id_div").hide();
    }
}

jQuery.validator.addMethod("wallet_balance", function(value) {
    value_int = parseInt(value);
    let wallet_balance =  $("#balance").val();
    wallet_balance = parseInt(wallet_balance);
    return value_int <= wallet_balance;
},`Insufficient general wallet balance.`);

var min_amount;
jQuery.validator.addMethod("min_withdraw_amount", function(value) {
    min_amount = $("#min_withdraw_amount").val();
    return parseFloat(value) >= min_amount;
}, function () {return 'Minimum ' + min_amount + "."});

$("#withdraw_form").validate({
    rules: {
        amount : {
            required            : true,
            wallet_balance      : true,
            min_withdraw_amount : true,
        },
        account_no : {
            required : function (element) { return $(element).is(":visible"); }
        },
        account_holder_name : {
            required : function (element) { return $(element).is(":visible"); }
        },
        bank_name : {
            required : function (element) { return $(element).is(":visible"); }
        },
        ifsc_code : {
            required : function (element) { return $(element).is(":visible"); }
        },
        upi_id : {
            required : function (element) { return $(element).is(":visible"); }
        },
    },
    
});

$(document).on('click', '#edit_withdraw_amount', function () {
    var $amt = $("#amount");
    $amt.focus();
    if ($amt[0] && $amt[0].select) $amt[0].select();
});
