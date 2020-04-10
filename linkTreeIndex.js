{
    $('.btn').click(function () {
        let url =  $(this).attr('data-url');
        window.open(url);
    })
}