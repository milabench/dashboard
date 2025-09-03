import React, { memo } from 'react';
import { Box, useColorModeValue } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

// Monaco Editor component for bash script editing
const MonacoEditorComponent: React.FC<{
    value: string;
    onChange: (value: string) => void;
    height?: string;
    onMount?: (editor: any) => void;
}> = ({ value, onChange, height = "400px", onMount }) => {
    const isDark = useColorModeValue(false, true);

    return (
        <Box
            border="1px solid"
            borderColor={useColorModeValue('gray.200', 'gray.600')}
            borderRadius="md"
            overflow="hidden"
            flex={1}
        >
            <Editor
                height={height}
                defaultLanguage="shell"
                value={value}
                onChange={(value) => onChange(value || '')}
                theme={isDark ? 'vs-dark' : 'light'}
                onMount={(editor, monaco) => {
                    const model = editor.getModel();
                    if (model) {
                      model.setEOL(monaco.editor.EndOfLineSequence.LF);
                    }
                    // Call the onMount callback if provided
                    if (onMount) {
                        onMount(editor);
                    }
                  }}
                options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto'
                    },
                    automaticLayout: true,
                    wordWrap: 'on',
                    folding: false, // Disable folding to reduce CPU usage
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    glyphMargin: false, // Disable glyph margin to reduce rendering
                    fixedOverflowWidgets: true,
                    overviewRulerBorder: false,
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    renderLineHighlight: 'line', // Reduce highlighting
                    selectOnLineNumbers: true,
                    contextmenu: true,
                    mouseWheelZoom: false, // Disable zoom to reduce CPU
                    quickSuggestions: false,
                    suggestOnTriggerCharacters: false,
                    acceptSuggestionOnEnter: 'off',
                    tabCompletion: 'off',
                    wordBasedSuggestions: 'off',
                    parameterHints: {
                        enabled: false
                    },
                    insertSpaces: true,
                    tabSize: 4,
                    // Performance optimizations
                    renderWhitespace: 'none',
                    renderControlCharacters: false,
                    renderIndentGuides: false,
                    smoothScrolling: false,
                    cursorBlinking: 'solid', // Reduce blinking effects
                    cursorSmoothCaretAnimation: false
                }}
            />
        </Box>
    );
};

// Memoized Monaco Editor to prevent unnecessary re-renders
export const MonacoEditor = memo(MonacoEditorComponent);