import os
import sys

# Isolated MADAR cPanel Passenger WSGI entry point (/home/boysyst3/madar)
# Does NOT touch /home/boysyst3/g3pibot
sys.path.insert(0, os.path.dirname(__file__))

from madar_cpanel_app import app as application  # noqa: E402, F401
