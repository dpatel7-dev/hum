# hum

```
  [Bumble]  hum  v1.0.0

            Your music, in a little panel
            at the side of the screen.
```

**hum plays your music from a little panel at the side of the screen.** It floats over whatever
you're doing without taking it over, and a bee in the menu bar opens and closes it. Your own music
files, songs from YouTube, playlists, a queue, shuffle, a sleep timer and an equalizer.

Bumble the bumblebee flies along the bar as the song plays, and the garden at the bottom sways to
the music.

## Get it

With [pca](https://github.com/dpatel7-dev/Project-CLI-Access): open pca, pick **hum**, press **I**. Or:

```sh
curl -fsSL https://djp7.pythonanywhere.com/hum/install.sh | sh
```

Then, once: `hum on`. From then on there's a bee in your menu bar (top right of the screen).

## Using it

| To | Do this |
| --- | --- |
| Open the panel | Click the **bee in the menu bar**, or press **⌃⌥M** (control + option + M), or type `hum` |
| Add your music | **+** › *Find music on this Mac* (looks in Music, Downloads, Desktop, Documents), *Choose music files…*, or drop files on the panel. Or `hum add ~/Music` |
| Add a song from YouTube | **+** › *Add a YouTube link…*, or `hum add https://youtu.be/…` |
| Play | Click a song. **Space** plays and pauses, **⇧←/⇧→** previous and next, **←/→** jump 5 seconds, **↑/↓** volume |
| Playlists | *Playlists › New playlist*, then **⋯ › Add to a playlist** on any song. Drag songs to put them in order |
| Up next | **⋯ › Play next** or *Add to up next* on any song. Drag to reorder |
| Like a song | **♥** (or **L**). They're all in *Liked* |
| Shuffle, repeat | the buttons either side of play (**S**, **R**) |
| Fall asleep to it | *Sleep*: stop in 15, 30, 45 or 60 minutes, or at the end of the song |
| Bass, middle, treble | *EQ* (for your own music files) |
| From Terminal | `hum` shows what's playing with keys to control it; `hum play homework` plays a playlist or a song; `hum pause`, `hum next`, `hum now` |
| A bigger window | `hum app` |
| Something doesn't work | `hum doctor` |

### Songs from YouTube

hum doesn't download anything from YouTube or turn videos into MP3s: that's against YouTube's rules
and usually the song's copyright. A YouTube song plays in **YouTube's own player**, right in the
panel, so you see the video while it plays, and it pauses when you close the panel. Your own music
files keep playing with the panel closed.

### Your music files

hum plays mp3, m4a/AAC, wav, aiff and flac. It reads the song's name, artist, album and cover picture
from the file (or uses the file name: `Artist - Song.mp3`). Your files stay where they are; hum only
remembers where. Files you drop on the panel are copied to `~/.hum/music`. Songs bought or
downloaded in the Music app with Apple Music are locked to that app, so hum skips those.

## Where things are

Your library and playlists are in `~/.hum/library.json`; cover pictures in `~/.hum/art`. The
player is a page served to this computer only (127.0.0.1, behind a secret address).

## Uninstall

```sh
hum uninstall
```

## How it works

Plain Node.js (18 or newer), no dependencies. The panel is a small program in macOS's own scripting
(JavaScript for Automation: no permissions, no administrator) with Apple's frosted glass and a web
view; the player page plays the music. The equalizer and the dancing garden use the browser's Web
Audio. `npm test` runs the tests.

MIT licence.
