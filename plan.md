Current scope: implement the songs-player lightbox and enlarged video. All X liking buttons, shortcuts, and confirmation toasts are deferred.

Verified selectors: `.dock.up` is the open player; `.dk-scr.pframe` is the video area. The lightbox uses the existing close action (stops playback), also available through Escape and backdrop click.

Original requirements:

- a user script to improve this website https://slophits.com.
- you to use the Chrome Dev tools similar to the project oldtweetdeck.
- on page https://slophits.com/#chart, I want a button "like" to the right of the program button.
  - This button has the same design as the others to the left.
  - Pressing this button likes this track on X.
  - A small toast in the same design as the buttons confirms that the like was successful.
- on page https://slophits.com/#chart, I want a shortcut 'L'
  - The shortcut is listed on the page right to the "F full screen" shortcut label.
  - Pressing the shortcut L likes the current played track on X.
  - A small toast in the same design as the toast above confirms that the like was successful.
- on page [https://slophits.com/songs](https://slophits.com/songs?view=tiles&size=l&f=rest),
  - I want the player Section which is represented by the class "doc up" (but please verify, This is my guess and not an instruction but a hint to the feature I'm talking about) , not on the bottom of the page, but as a lightbox.
  - I want the player (I assume class dk-scr pframe, But please verify) bigger, therefor the next divs must break to the next row.
  - The size of the player can be the same as on the individual clip page (i.e. [https://slophits.com/clip/2106157622986748377)](https://slophits.com/clip/2106157622986748377)
  - I want a button "like" to the right of the "next" button.
    - This button has the same design as the others to the left.
    - Pressing this button likes this track on X.
    - A small toast in the same design as the buttons confirms that the like was successful.
