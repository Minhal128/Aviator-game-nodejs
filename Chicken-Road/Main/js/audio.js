// audio.js
function a(src) {
    var el = new Audio(src);
    el.preload = 'none';
    return el;
}
export const sndBgm = a('assets/audio/bgm.mp3');
sndBgm.loop = true;
export const sndCrash = a('assets/audio/crash.mp3');
export const sndPassby = a('assets/audio/passby.mp3');
export const sndHonk1 = a('assets/audio/honk1.mp3');
export const sndHonk2 = a('assets/audio/honk2.mp3');
export const sndBrake = a('assets/audio/brake.mp3');
export const sndGo = a('assets/audio/go.mp3');
export const sndCashout = a('assets/audio/cashout.mp3');
export const sndButton = a('assets/audio/buttons.mp3');

let sfxVolume = 1.0;

export function handleMusicVolumeChange(val) {
    sndBgm.volume = parseFloat(val);
    if (sndBgm.volume > 0 && sndBgm.paused) {
        sndBgm.play().catch(e => console.log("Waiting for user interaction to play BGM"));
    }
}

export function handleSfxVolumeChange(val) {
    sfxVolume = parseFloat(val);
}

export function playSound(audioObj) {
    if (sfxVolume > 0 && audioObj) {
        let snd = audioObj.cloneNode();
        snd.volume = sfxVolume;
        snd.play().catch(e => {});
    }
}
