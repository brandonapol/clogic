-- Opens a Logic Pro dialog through its menu, after asking the user. It never clicks Save, Bounce or OK.
-- Usage: osascript open-export-dialog.applescript export   (File > Export > All Tracks as Audio Files)
--        osascript open-export-dialog.applescript bounce   (File > Bounce > Project or Section)

on run argv
	set target to "export"
	if (count of argv) > 0 then set target to item 1 of argv
	if target is "bounce" then
		set topMenu to "File"
		set subMenu to "Bounce"
		set itemPrefix to "Project or Section"
	else
		set topMenu to "File"
		set subMenu to "Export"
		set itemPrefix to "All Tracks as Audio Files"
	end if

	display dialog "Open Logic Pro's " & topMenu & " > " & subMenu & " > " & itemPrefix & " dialog? Nothing is written until you click the dialog's own button yourself." buttons {"Cancel", "Open dialog"} default button "Cancel" cancel button "Cancel"

	tell application id "com.apple.logic10" to activate
	tell application "System Events"
		tell (first application process whose bundle identifier is "com.apple.logic10")
			set exportMenu to menu 1 of menu item subMenu of menu 1 of menu bar item topMenu of menu bar 1
			click (first menu item of exportMenu whose name starts with itemPrefix)
			delay 2
			set windowNames to {}
			repeat with w in windows
				try
					set windowNames to windowNames & {(name of w as text) & " [" & (subrole of w as text) & "]"}
				on error
					set windowNames to windowNames & {"(unnamed window)"}
				end try
			end repeat
		end tell
	end tell
	set AppleScript's text item delimiters to ", "
	return "windows 2s after click: " & (windowNames as text)
end run
