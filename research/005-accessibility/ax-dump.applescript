-- Dumps Logic Pro's accessibility tree, read only.
-- Usage: osascript ax-dump.applescript [maxDepth] [windowIndex]
-- The process running osascript (usually your terminal app) needs Accessibility permission.

on run argv
	set maxDepth to 6
	set windowIndex to 0
	if (count of argv) > 0 then set maxDepth to (item 1 of argv) as integer
	if (count of argv) > 1 then set windowIndex to (item 2 of argv) as integer
	set outLines to {}
	tell application "System Events"
		set logicProcess to first application process whose bundle identifier is "com.apple.logic10"
		set allWindows to windows of logicProcess
		repeat with i from 1 to count of allWindows
			if windowIndex is 0 or windowIndex is i then
				set outLines to outLines & {"# window " & i} & my dumpElement(item i of allWindows, 0, maxDepth)
			end if
		end repeat
	end tell
	set AppleScript's text item delimiters to linefeed
	return outLines as text
end run

on dumpElement(el, depth, maxDepth)
	set entryText to my indent(depth) & my attr(el, "AXRole") & " | sub=" & my attr(el, "AXSubrole") & " | id=" & my attr(el, "AXIdentifier") & " | title=" & my attr(el, "AXTitle") & " | desc=" & my attr(el, "AXDescription") & " | value=" & my attr(el, "AXValue")
	set collected to {entryText}
	if depth < maxDepth then
		tell application "System Events"
			try
				set kids to UI elements of el
			on error
				set kids to {}
			end try
		end tell
		repeat with kid in kids
			set collected to collected & my dumpElement(kid, depth + 1, maxDepth)
		end repeat
	end if
	return collected
end dumpElement

on attr(el, attributeName)
	tell application "System Events"
		try
			set v to value of attribute attributeName of el
			if v is missing value then return ""
			return v as text
		on error
			return ""
		end try
	end tell
end attr

on indent(depth)
	set s to ""
	repeat depth times
		set s to s & "  "
	end repeat
	return s
end indent
