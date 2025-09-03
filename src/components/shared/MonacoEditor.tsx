import React from 'react';
import { Box, useColorModeValue } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

// Monaco Editor component for bash script editing
export const MonacoEditor: React.FC<{
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
                        vertical: 'visible',
                        horizontal: 'visible'
                    },
                    automaticLayout: true,
                    wordWrap: 'on',
                    folding: true,
                    foldingStrategy: 'indentation',
                    showFoldingControls: 'always',
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    glyphMargin: true,
                    fixedOverflowWidgets: true,
                    overviewRulerBorder: false,
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    renderLineHighlight: 'all',
                    selectOnLineNumbers: true,
                    contextmenu: true,
                    mouseWheelZoom: true,
                    quickSuggestions: false,
                    suggestOnTriggerCharacters: false,
                    acceptSuggestionOnEnter: 'on',
                    tabCompletion: 'on',
                    wordBasedSuggestions: 'off',
                    parameterHints: {
                        enabled: false
                    },
                    insertSpaces: true,
                    tabSize: 4
                }}
            />
        </Box>
    );
};