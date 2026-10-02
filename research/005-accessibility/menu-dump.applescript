-- Lists Logic Pro's menu bar to two levels, read only. Used to record menu paths and check localisation.
-- Usage: osascript menu-dump.applescript

on run
	set outLines to {}
	tell application "System Events"
		set logicProcess to first application process whose bundle identifier is "com.apple.logic10"
		repeat with barItem in menu bar items of menu bar 1 of logicProcess
			set outLines to outLines & {name of barItem as text}
			try
				repeat with mi in menu items of menu 1 of barItem
					set itemName to name of mi
					if itemName is not missing value then
						set outLines to outLines & {"  " & itemName}
						try
							repeat with sub in menu items of menu 1 of mi
								set subName to name of sub
								if subName is not missing value then set outLines to outLines & {"    " & subName}
							end repeat
						end try
					end if
				end repeat
			end try
		end repeat
	end tell
	set AppleScript's text item delimiters to linefeed
	return outLines as text
end run
