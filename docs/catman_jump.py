#!/usr/bin/env python3
import time
import os

# ASCII art frames for the animation
frames = [
    # Frame 1: Starting position
    """
       /\\_/\\
      ( o.o )
       > ^ <
        | |
        / \\
       /   \\
    ___| |___
    |_______|
    """,
    
    # Frame 2: Crouch before jump
    """
       /\\_/\\
      ( >.< )
       > ^ <
        \\|/
         |
        / \\
    ___| |___
    |_______|
    """,
    
    # Frame 3: Beginning of jump
    """
      /\\_/\\
     ( o.o )
      > ^ <
       \\|/
        |
       / \\
    ___| |___
    |_______|
    """,
    
    # Frame 4: Mid-jump over chair
    """
    /\\_/\\
   ( ^.^ )
    > ^ <
     \\|/
      |
     / \\
    
    ___| |___
    |_______|
    """,
    
    # Frame 5: Peak of jump
    """
   /\\_/\\
  ( o.o )
   > ^ <
    \\|/
     |
    / \\
    
    
    ___| |___
    |_______|
    """,
    
    # Frame 6: Descending
    """
         /\\_/\\
        ( o.o )
         > ^ <
          \\|/
           |
          / \\
    
    ___| |___
    |_______|
    """,
    
    # Frame 7: Landing
    """
          /\\_/\\
         ( >.< )
          > ^ <
           \\|/
            |
           / \\
    ___| |___
    |_______|
    """,
    
    # Frame 8: Landed successfully
    """
           /\\_/\\
          ( ^.^ )
           > ^ <
            | |
            / \\
           /   \\
    ___| |___
    |_______|
    """
]

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def animate():
    print("Watch the cat-faced man jump over the chair!")
    print("Press Ctrl+C to exit\n")
    time.sleep(2)
    
    try:
        while True:
            for frame in frames:
                clear_screen()
                print(frame)
                time.sleep(0.3)
            
            # Pause a bit after landing
            time.sleep(1)
            
    except KeyboardInterrupt:
        clear_screen()
        print("\nThanks for watching! =^.^=")

if __name__ == "__main__":
    animate()