#!/usr/bin/env python3
import time
import os
import sys

# ASCII art frames for walking cat
cat_frames = [
    [
        "    /\\_/\\  ",
        "   ( o.o ) ",
        "    > ^ <  ",
        "   /|   |\\ ",
        "  (_)   (_)"
    ],
    [
        "    /\\_/\\  ",
        "   ( o.o ) ",
        "    > ^ <  ",
        "   /|   |\\ ",
        "  (_) (_)  "
    ],
    [
        "    /\\_/\\  ",
        "   ( o.o ) ",
        "    > ^ <  ",
        "   /|   |\\ ",
        "    (_) (_)"
    ],
    [
        "    /\\_/\\  ",
        "   ( o.o ) ",
        "    > ^ <  ",
        "   /|   |\\ ",
        "  (_) (_)  "
    ]
]

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def get_terminal_width():
    try:
        columns = os.get_terminal_size().columns
        return columns
    except:
        return 80  # Default width

def print_cat_at_position(cat_frame, position, width):
    # Clear screen
    clear_screen()
    
    # Print some empty lines for vertical centering
    print("\n" * 5)
    
    # Print each line of the cat with appropriate spacing
    for line in cat_frame:
        # Calculate padding to position cat
        if position < width - len(line):
            print(" " * position + line)
        else:
            # Cat is partially off-screen
            visible_part = line[:width - position]
            if visible_part:
                print(" " * position + visible_part)
            else:
                print()
    
    # Print ground line
    print("-" * width)

def main():
    print("Press Ctrl+C to stop the cat!")
    time.sleep(2)
    
    terminal_width = get_terminal_width()
    cat_width = max(len(line) for line in cat_frames[0])
    
    try:
        while True:
            # Walk from left to right
            for position in range(-cat_width, terminal_width + 5):
                frame_index = (position // 2) % len(cat_frames)
                print_cat_at_position(cat_frames[frame_index], position, terminal_width)
                time.sleep(0.1)
            
            # Walk from right to left (cat faces the other way)
            reversed_cat_frames = []
            for frame in cat_frames:
                reversed_frame = []
                for line in frame:
                    # Simple reversal - not perfect but works
                    if "(_)" in line and "(_)" in line:
                        reversed_line = line.replace("/\\_/\\", "\\_/\\_")
                        reversed_line = reversed_line.replace("> ^ <", "< ^ >")
                        reversed_line = reversed_line.replace("/|   |\\", "\\|   |/")
                    else:
                        reversed_line = line
                    reversed_frame.append(reversed_line)
                reversed_cat_frames.append(reversed_frame)
            
            for position in range(terminal_width, -cat_width - 5, -1):
                frame_index = (position // 2) % len(reversed_cat_frames)
                print_cat_at_position(reversed_cat_frames[frame_index], position, terminal_width)
                time.sleep(0.1)
                
    except KeyboardInterrupt:
        clear_screen()
        print("\nThe cat went home! 🐱")
        sys.exit(0)

if __name__ == "__main__":
    main()