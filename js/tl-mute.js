// QA aid: silence a game without touching its own sound settings.
// Injected by Pages::gameStatic() only when the URL carries ?mute=1.
// Routes every WebAudio graph through a zero gain (works for Construct and
// Phaser alike, since both end at ctx.destination) and mutes plain media tags.
(function () {
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
        if (dest && dest.context && dest === dest.context.destination) {
            let sink = dest.context.__tlMuteSink;
            if (!sink) {
                sink = dest.context.createGain();
                sink.gain.value = 0;
                origConnect.call(sink, dest);
                dest.context.__tlMuteSink = sink;
            }
            return origConnect.call(this, sink, ...rest);
        }
        return origConnect.call(this, dest, ...rest);
    };

    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        this.muted = true;
        this.volume = 0;
        return origPlay.apply(this, arguments);
    };
})();
