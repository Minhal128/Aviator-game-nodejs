<?php

$audio = file_get_contents(__DIR__ . '/../../ludo/ludo-royale/client/src/core/audio.ts');

assert(str_contains($audio, 'warmPad(c, bus, chord'), 'background music includes the warm pad');
assert(str_contains($audio, "const BPM = 92"), 'background loop uses the smoother tempo');
assert(str_contains($audio, "filter.type = 'lowpass'"), 'pad removes harsh high frequencies');
assert(str_contains($audio, 'setMusicOn(on: boolean)'), 'existing music toggle remains available');
assert(str_contains($audio, "case 'roll'"), 'existing game SFX remain available');

echo "ludo_music_check OK\n";
