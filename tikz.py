import tkinter as tk
from tkinter import scrolledtext, colorchooser
import webcolors  #  handle named colors
import math

class TikZApp:
    def __init__(self, master):
        self.master = master
        master.title("TikZ Drawing Tool")

        self.canvas = tk.Canvas(master, bg='white', width=600, height=400)
        self.canvas.pack(fill=tk.BOTH, expand=True)

        self.start_point = None
        self.lines = []
        self.shapes = []
        self.polygon_points = []
        self.current_shape = None
        self.drag_data = {"x": 0, "y": 0, "item": None}

        self.line_color = 'black'
        self.fill_color = 'white'
        self.fill_pattern = ''
        self.text_color = 'black'
        self.current_fill_color = '#ffffff'  # Use hexadecimal format for the default fill color

        self.canvas.bind("<Button-1>", self.start_line)
        self.master.bind("<KeyPress-Shift_L>", self.shift_pressed)
        self.master.bind("<KeyRelease-Shift_L>", self.shift_released)
        self.master.bind("<Delete>", self.delete_item)
        self.master.bind("<Command-z>", self.undo_last_action)
        self.master.bind("<KeyPress-r>", self.rotate_shape) # lowercase r

        self.canvas.bind("<Button-1>", self.on_item_click)
        self.canvas.bind("<B1-Motion>", self.on_item_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_item_release)

        
        self.shift_down = False

        self.toolbar = tk.Frame(master)
        self.toolbar.pack(pady=10)

        self.add_shape_buttons()

        self.color_button = tk.Button(self.toolbar, text="Choose Color", command=self.choose_color)
        self.color_button.pack(side=tk.LEFT, padx=5)

        self.fill_color_button = tk.Button(self.toolbar, text="Choose Fill Color", command=self.choose_fill_color)
        self.fill_color_button.pack(side=tk.LEFT, padx=5)

        self.text_color_button = tk.Button(self.toolbar, text="Choose Text Color", command=self.choose_text_color)
        self.text_color_button.pack(side=tk.LEFT, padx=5)

        self.arrow_var = tk.StringVar(value='none')
        self.arrow_menu = tk.OptionMenu(self.toolbar, self.arrow_var, 'none', '->', '<-', '<->')
        self.arrow_menu.pack(side=tk.LEFT, padx=5)

        self.fill_pattern_var = tk.StringVar(value='none')
        fill_patterns = ['none', 'horizontal lines', 'vertical lines', 'north east lines', 'north west lines', 'grid', 'crosshatch']
        self.fill_pattern_menu = tk.OptionMenu(self.toolbar, self.fill_pattern_var, *fill_patterns)
        self.fill_pattern_menu.pack(side=tk.LEFT, padx=5)

        self.tikz_output = scrolledtext.ScrolledText(master, width=50, height=10)
        self.tikz_output.pack(pady=10)

        # Create a frame for the buttons
        self.button_frame = tk.Frame(master)
        self.button_frame.pack(pady=10)

        # Create the "Copy Code" button
        self.copy_button = tk.Button(self.button_frame, text="Copy Code", command=self.copy_code)
        self.copy_button.pack(side=tk.LEFT, padx=5)

        # Move the clear_button into the button_frame
        self.clear_button = tk.Button(self.button_frame, text="Clear Canvas", command=self.clear_canvas)
        self.clear_button.pack(side=tk.LEFT, padx=5)

        self.grid_size = 20
        self.draw_grid()

        master.geometry("900x700")
        master.bind("<Configure>", self.resize_canvas)

        self.hovered_item = None
        self.text_entries = {}
        self.text_history = []  # To keep track of text changes for undo
        self.master.bind("<Shift-Key>", self.add_text_to_shape)
        self.master.bind("<BackSpace>", self.remove_text_from_shape)
        self.canvas.bind("<Motion>", self.hover_item)

    def resize_canvas(self, event):
        self.draw_grid()
        self.canvas.config(scrollregion=self.canvas.bbox("all"))  # Update scroll region

    def draw_grid(self):
        self.canvas.delete('grid_line')
        width, height = self.canvas.winfo_width(), self.canvas.winfo_height()
        for i in range(0, width, self.grid_size):
            self.canvas.create_line([(i, 0), (i, height)], tag='grid_line', fill='lightblue')
        for i in range(0, height, self.grid_size):
            self.canvas.create_line([(0, i), (width, i)], tag='grid_line', fill='lightblue')
        self.canvas.tag_lower('grid_line')  # Draw grid lines behind other items

    def snap_to_grid(self, x, y):
        return (round(x / self.grid_size) * self.grid_size, round(y / self.grid_size) * self.grid_size)

    def add_shape_buttons(self):
        shapes = ['●', '■', '⏢']
        shape_names = ['Circle', 'Rectangle', 'Trapezoid']
        for shape, name in zip(shapes, shape_names):
            button = tk.Button(self.toolbar, text=shape, command=lambda s=name: self.add_shape(s))
            button.pack(side=tk.LEFT, padx=5)

    def add_shape(self, shape):
        self.canvas.bind("<Button-1>", lambda event, s=shape: self.start_shape(event, s))
        self.canvas.bind("<B1-Motion>", self.draw_shape)
        self.canvas.bind("<ButtonRelease-1>", lambda event: self.end_shape(event, reset=True))

    def start_shape(self, event, shape):
        self.start_point = self.snap_to_grid(event.x, event.y)
        self.current_shape = shape

    def get_tkinter_stipple_pattern(self, pattern):
        stipple_mapping = {
            'none': None,
            'horizontal lines': 'gray50',
            'vertical lines': 'gray75',
            'north east lines': 'gray25',
            'north west lines': 'gray12',
            'grid': 'gray50',
            'crosshatch': 'gray25',
        }
        return stipple_mapping.get(pattern)

    def draw_shape(self, event):
        if self.start_point:
            self.canvas.delete("temp_shape")
            end_point = self.snap_to_grid(event.x, event.y)
            shape_kwargs = {
                'outline': self.line_color,
                'fill': self.current_fill_color,
                'tags': "temp_shape"
            }
            if self.current_shape == 'Circle':
                self.canvas.create_oval(
                    self.start_point[0], self.start_point[1],
                    end_point[0], end_point[1],
                    **shape_kwargs
                )
            elif self.current_shape == 'Rectangle':
                self.canvas.create_rectangle(
                    self.start_point[0], self.start_point[1],
                    end_point[0], end_point[1],
                    **shape_kwargs
                )
            elif self.current_shape == 'Trapezoid':
                points = [
                    self.start_point,
                    (end_point[0], self.start_point[1]),
                    (end_point[0] - 20, end_point[1]),
                    (self.start_point[0] + 20, end_point[1])
                ]
                self.canvas.create_polygon(
                    points,
                    **shape_kwargs
                )

    def end_shape(self, event, reset=False):
        if self.start_point:
            self.canvas.delete("temp_shape")
            end_point = self.snap_to_grid(event.x, event.y)
            shape_kwargs = {
                'outline': self.line_color,
                'fill': self.current_fill_color,  # Use the current fill color
                'tags': f"permanent_shape_{len(self.shapes)}"
            }
            shape_id = None
            fill_pattern = self.fill_pattern_var.get()
            if self.current_shape == 'Circle':
                shape_id = self.canvas.create_oval(
                    self.start_point[0], self.start_point[1],
                    end_point[0], end_point[1],
                    **shape_kwargs
                )
                self.canvas.create_oval(
                    self.start_point[0], self.start_point[1],
                    end_point[0], end_point[1],
                    **shape_kwargs
                )
                self.shapes.append(
                    ('Circle', (self.start_point, end_point), shape_id, fill_pattern, self.current_fill_color, )
                )
            elif self.current_shape == 'Rectangle':
                shape_id = self.canvas.create_rectangle(
                    self.start_point[0], self.start_point[1],
                    end_point[0], end_point[1],
                    **shape_kwargs
                )
                self.shapes.append(
                    ('Rectangle', (self.start_point, end_point), shape_id, fill_pattern, self.current_fill_color)
                )
            elif self.current_shape == 'Trapezoid':
                points = [
                    self.start_point,
                    (end_point[0], self.start_point[1]),
                    (end_point[0] - 20, end_point[1]),
                    (self.start_point[0] + 20, end_point[1])
                ]
                shape_id = self.canvas.create_polygon(
                    points,
                    **shape_kwargs
                )
                self.shapes.append(
                    ('Trapezoid', points, shape_id, fill_pattern, self.current_fill_color)
                )

            self.start_point = None

            if reset:
                self.canvas.bind("<Button-1>", self.start_line)

            self.generate_tikz_code()

    def rotate_shape(self, event):
        if not self.shapes:
            return

        last_shape = self.shapes[-1]
        shape_type, points, shape_id, fill_pattern, fill_color = last_shape

        if shape_type == 'Circle':
            return 

        angle_rad =  math.pi  / 2

        def rotate_point(px, py, cx, cy, angle_rad):
            s, c = math.sin(angle_rad), math.cos(angle_rad)
            px, py = px - cx, py - cy
            x_new = px * c - py * s
            y_new = px * s + py * c
            return x_new + cx, y_new + cy

        if shape_type == 'Rectangle':
            cx, cy = (points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2
            new_points = [
            rotate_point(points[0][0], points[0][1], cx, cy, angle_rad),
            rotate_point(points[1][0], points[1][1], cx, cy, angle_rad)
            ]
        elif shape_type == 'Trapezoid':
            cx, cy = sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4
            new_points = [rotate_point(p[0], p[1], cx, cy, angle_rad) for p in points]

        self.canvas.delete(shape_id)
        shape_kwargs = {
            'outline': self.line_color,
            'fill': self.current_fill_color,
            'tags': "permanent_shape"
        }
        stipple_pattern = self.get_tkinter_stipple_pattern(fill_pattern)
        if stipple_pattern:
            shape_kwargs['stipple'] = stipple_pattern

        shape_id = self.canvas.create_polygon(new_points, **shape_kwargs)
        self.shapes[-1] = (shape_type, new_points, shape_id, fill_pattern, fill_color)

        self.generate_tikz_code()

    def on_item_click(self, event):
        # Record the item and its initial position
        item = self.canvas.find_closest(event.x, event.y)[0]
        print(f"Clicked item ID: {item}, Tags: {self.canvas.gettags(item)}")  # Debugging statement
        if "grid_line" not in self.canvas.gettags(item):
            self.drag_data["item"] = item
            self.drag_data["x"] = event.x
            self.drag_data["y"] = event.y


    def on_item_drag(self, event):
        # Calculate the distance moved
        dx = event.x - self.drag_data["x"]
        dy = event.y - self.drag_data["y"]
        # Move the item
        self.canvas.move(self.drag_data["item"], dx, dy)
        # Update the drag data
        self.drag_data["x"] = event.x
        self.drag_data["y"] = event.y

    def on_item_release(self, event):
        # Clear the drag data
        self.drag_data["item"] = None
        self.drag_data["x"] = 0
        self.drag_data["y"] = 0

    def select_item(self, event):
        self.selected_item = self.canvas.find_closest(event.x, event.y)[0]
        self.drag_data["item"] = self.selected_item
        self.drag_data["x"] = event.x
        self.drag_data["y"] = event.y

    def deselect_item(self, event):
        self.selected_item = None
        self.drag_data["item"] = None

    def choose_color(self):
        color_code = colorchooser.askcolor(title="Choose line color")
        if color_code:
            self.line_color = color_code[1]

    def choose_fill_color(self):
        color_code = colorchooser.askcolor(title="Choose fill color")
        if color_code:
            self.current_fill_color = color_code[1]  # Store the color in hexadecimal format

    def hex_to_tikz_rgb(self, color):
        if color.startswith('#'):
            color = color[1:]
        elif color in webcolors.CSS3_NAMES_TO_HEX:
            color = webcolors.CSS3_NAMES_TO_HEX[color][1:]
        r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
        return f"{{rgb,255:red,{r};green,{g};blue,{b}}}"

    def get_shape_fill_options(self, pattern, color):
        tikz_color = self.hex_to_tikz_rgb(color) if color != 'none' else 'none'
        if pattern == 'none' and color == 'none':
            return ''
        elif pattern == 'none':
            return f' [fill={tikz_color}]'
        elif color == 'none':
            return f' [pattern={pattern}]'
        return f' [pattern={pattern}, fill={tikz_color}]'

    def choose_text_color(self):
        color_code = colorchooser.askcolor(title="Choose text color")
        if color_code:
            self.text_color = color_code[1]

    def start_line(self, event):
        if self.shift_down:
            self.start_point = self.snap_to_grid(event.x, event.y)
            self.polygon_points.append(self.start_point)
            self.canvas.bind("<B1-Motion>", self.draw_line)
            self.canvas.bind("<ButtonRelease-1>", self.end_line)

    def draw_line(self, event):
        if self.start_point:
            self.canvas.delete("temp_line")
            end_point = self.snap_to_grid(event.x, event.y)
            self.canvas.create_line(self.start_point[0], self.start_point[1], end_point[0], end_point[1], fill=self.line_color, tags="temp_line")
            if len(self.polygon_points) > 1:
                self.canvas.delete("temp_polygon")
                points = self.polygon_points + [end_point]
                self.canvas.create_line(points, fill=self.line_color, tags="temp_polygon")

    def end_line(self, event):
        if self.start_point:
            end_point = self.snap_to_grid(event.x, event.y)
            if self.start_point != end_point:  # Ensure start and end points are not the same
                arrow_option = self.get_tkinter_arrow_option(self.arrow_var.get())
                line_id = self.canvas.create_line(self.start_point[0], self.start_point[1], end_point[0], end_point[1], fill=self.line_color, arrow=arrow_option, tags="permanent_line")
                # Store the arrow type with the line data
                self.lines.append((self.start_point, end_point, line_id, self.arrow_var.get()))
            self.polygon_points = []  # Reset polygon points after each line
            self.start_point = None
            self.canvas.delete("temp_line")

            self.generate_tikz_code()

    def get_tkinter_arrow_option(self, arrow_type):
        if arrow_type == '->':
            return tk.LAST
        elif arrow_type == '<-':
            return tk.FIRST
        elif arrow_type == '<->':
            return tk.BOTH
        else:
            return None

    def get_tikz_arrow_option(self, arrow_type):
        if arrow_type == '->':
            return ' [->]'
        elif arrow_type == '<-':
            return ' [<-]'
        elif arrow_type == '<->':
            return ' [<->]'
        else:
            return ''

    def get_tikz_line_style(self):
        pattern = self.fill_pattern_var.get()
        if pattern == 'solid':
            return ''
        else:
            return f' [{pattern}]'

    def hover_item(self, event):
        closest_items = self.canvas.find_closest(event.x, event.y)
        self.hovered_item = closest_items[0] if closest_items else None

    def add_text_to_shape(self, event):
        if self.hovered_item:
            item_coords = self.canvas.coords(self.hovered_item)
            if item_coords:
                x_center = (item_coords[0] + item_coords[2]) / 2
                y_center = (item_coords[1] + item_coords[3]) / 2
                if self.hovered_item not in self.text_entries:
                    self.text_entries[self.hovered_item] = ""
                self.text_history.append((self.hovered_item, self.text_entries[self.hovered_item]))  # Save current text state
                self.text_entries[self.hovered_item] += event.char
                self.text_entries[self.hovered_item] = (self.text_entries[self.hovered_item]).title()
                self.canvas.delete(f"text_{self.hovered_item}")
                text_id = self.canvas.create_text(x_center, y_center, text=self.text_entries[self.hovered_item], fill=self.text_color, tags=f"text_{self.hovered_item}")
                self.canvas.tag_raise(text_id)
                self.generate_tikz_code()

    def remove_text_from_shape(self, event):
        if self.hovered_item and self.hovered_item in self.text_entries:
            if self.text_entries[self.hovered_item]:
                self.text_history.append((self.hovered_item, self.text_entries[self.hovered_item]))  # Save current text state
                self.text_entries[self.hovered_item] = self.text_entries[self.hovered_item][:-1]  # Remove last character
                self.canvas.delete(f"text_{self.hovered_item}")
                if self.text_entries[self.hovered_item]:
                    item_coords = self.canvas.coords(self.hovered_item)
                    x_center = (item_coords[0] + item_coords[2]) / 2
                    y_center = (item_coords[1] + item_coords[3]) / 2
                    text_id = self.canvas.create_text(x_center, y_center, text=self.text_entries[self.hovered_item], fill=self.text_color, tags=f"text_{self.hovered_item}")
                    self.canvas.tag_raise(text_id)
                self.generate_tikz_code()

    def delete_item(self, event):
        if self.hovered_item:
            self.canvas.delete(self.hovered_item)
            self.hovered_item = None
            self.generate_tikz_code()

    def undo_last_action(self, event):
        if self.lines:
            last_line = self.lines.pop()
            self.canvas.delete(last_line[2])
        elif self.shapes:
            last_shape = self.shapes.pop()
            self.canvas.delete(last_shape[2])
        elif self.text_history:
            last_text_entry = self.text_history.pop()
            item_id, text = last_text_entry
            self.text_entries[item_id] = text
            self.canvas.delete(f"text_{item_id}")
            if text:
                item_coords = self.canvas.coords(item_id)
                x_center = (item_coords[0] + item_coords[2]) / 2
                y_center = (item_coords[1] + item_coords[3]) / 2
                text_id = self.canvas.create_text(x_center, y_center, text=text, fill=self.text_color, tags=f"text_{item_id}")
                self.canvas.tag_raise(text_id)
        self.generate_tikz_code()

    def clear_canvas(self):
        self.canvas.delete("all")
        self.lines.clear()
        self.shapes.clear()
        self.polygon_points.clear()
        self.text_entries.clear()
        self.text_history.clear()
        self.generate_tikz_code()
        self.draw_grid()  # Redraw the grid after clearing the canvas

    def copy_code(self):
        tikz_code = self.tikz_output.get("1.0", tk.END)
        self.master.clipboard_clear()
        self.master.clipboard_append(tikz_code)
        self.master.update()  # Keeps the clipboard content after the app is closed

    def generate_tikz_code(self):
        if not self.lines and not self.shapes:
            self.tikz_output.delete("1.0", tk.END)
            self.tikz_output.insert(tk.END, "No lines or shapes drawn.")
            return
        
        tikz_code = r"\begin{tikzpicture}" + "\n"
        
        for (start, end, _, arrow_type) in self.lines:
            arrow_style = self.get_tikz_arrow_option(arrow_type)
            line_style = self.get_tikz_line_style()
            tikz_code += f"    \\draw{arrow_style} {self.format_point(start)} -- {self.format_point(end)};\n"
        
        for shape, points, shape_id, fill_pattern, fill_color in self.shapes:
            fill_option = self.get_shape_fill_options(fill_pattern, fill_color)
            if shape == 'Trapezoid':
                tikz_code += f"    \\draw{fill_option} {' -- '.join(self.format_point(p) for p in points)} -- cycle;\n"
            elif shape == 'Circle':
                (start, end) = points
                radius = self.calculate_radius(start, end) / 40
                tikz_code += f"    \\draw{fill_option} {self.format_point(start)} circle ({radius});\n"
            elif shape == 'Rectangle':
                (start, end) = points
                tikz_code += f"    \\draw{fill_option} {self.format_point(start)} rectangle {self.format_point(end)};\n"
            if shape_id in self.text_entries:
                x_center = (self.canvas.coords(shape_id)[0] + self.canvas.coords(shape_id)[2]) / 2
                y_center = (self.canvas.coords(shape_id)[1] + self.canvas.coords(shape_id)[3]) / 2
                tikz_code += f"    \\node at {self.format_point((x_center, y_center))} {{{self.text_entries[shape_id]}}};\n"

        tikz_code += r"\end{tikzpicture}"
        
        self.tikz_output.delete("1.0", tk.END)
        self.tikz_output.insert(tk.END, tikz_code)

    def calculate_radius(self, start, end):
        return ((end[0] - start[0])**2 + (end[1] - start[1])**2)**0.5 / 2

    def format_point(self, point):
        x, y = point
        height = self.canvas.winfo_height()
        x_scaled = x / 40
        y_scaled = (-y + height) / 40
        return f"({x_scaled}, {y_scaled})"

    def get_shape_fill_options(self, pattern, color):
        tikz_color = self.hex_to_tikz_rgb(color) if color != 'none' else 'none'
        if pattern == 'none' and color == 'none':
            return ''
        elif pattern == 'none':
            return f' [line width=0.5mm, fill={tikz_color}]'
        elif color == 'none':
            return f' [line width=0.5mm, pattern={pattern}]'
        return f' [line width=0.5mm, pattern={pattern}, fill={tikz_color}]'

    def shift_pressed(self, event):
        self.shift_down = True

    def shift_released(self, event):
        self.shift_down = False

if __name__ == "__main__":
    import sys
    import logging

    logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)

    root = tk.Tk()
    app = TikZApp(root)
    root.mainloop()
