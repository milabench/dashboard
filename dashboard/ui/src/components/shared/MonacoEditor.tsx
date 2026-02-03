import React from 'react';
import { useColorModeValue } from '../ui/color-mode';
import { Box } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

// Monaco Editor component for bash script editing
export const MonacoEditor: React.FC<{
    value: string;
    onChange: (value: string) => void;
    onMount: (editor: any) => void;
    height?: string;
}> = ({ value, onChange, onMount, height = "400px" }) => {
    const isDark = useColorModeValue(false, true);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [editorHeight, setEditorHeight] = React.useState(height);
    const lastHeightRef = React.useRef<number>(0);
    const updateTimeoutRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        if (height === "100%" && containerRef.current) {
            const updateHeight = () => {
                if (containerRef.current && containerRef.current.parentElement) {
                    const parentRect = containerRef.current.parentElement.getBoundingClientRect();
                    const newHeight = parentRect.height;

                    // Only update if height actually changed significantly (more than 2px difference)
                    if (newHeight > 0 && Math.abs(newHeight - lastHeightRef.current) > 2) {
                        lastHeightRef.current = newHeight;
                        setEditorHeight(`${newHeight}px`);
                    }
                }
            };

            // Initial update after a short delay to ensure layout is stable
            const initialTimeout = window.setTimeout(() => {
                requestAnimationFrame(updateHeight);
            }, 100);

            // Watch parent container resize, not the editor container itself
            let resizeObserver: ResizeObserver | null = null;
            const parentElement = containerRef.current.parentElement;

            if (parentElement) {
                resizeObserver = new ResizeObserver(() => {
                    // Clear any pending updates
                    if (updateTimeoutRef.current !== null) {
                        window.clearTimeout(updateTimeoutRef.current);
                    }

                    // Debounce updates to prevent rapid-fire changes
                    updateTimeoutRef.current = window.setTimeout(() => {
                        requestAnimationFrame(updateHeight);
                    }, 50);
                });
                resizeObserver.observe(parentElement);
            }

            // Also listen to window resize with debounce
            let resizeTimeout: number;
            const handleResize = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = window.setTimeout(() => {
                    requestAnimationFrame(updateHeight);
                }, 150);
            };
            window.addEventListener('resize', handleResize);

            return () => {
                window.clearTimeout(initialTimeout);
                if (updateTimeoutRef.current !== null) {
                    window.clearTimeout(updateTimeoutRef.current);
                }
                if (resizeObserver) {
                    resizeObserver.disconnect();
                }
                window.removeEventListener('resize', handleResize);
                window.clearTimeout(resizeTimeout);
            };
        } else {
            setEditorHeight(height);
        }
    }, [height]);

    return (
        <Box
            ref={containerRef}
            border="1px solid"
            borderColor={useColorModeValue('gray.200', 'gray.600')}
            borderRadius="md"
            overflow="hidden"
            flex={1}
            height={height === "100%" ? "100%" : undefined}
            minH={height === "100%" ? "400px" : undefined}
            maxH={height === "100%" ? "100%" : undefined}
            display="flex"
            flexDirection="column"
            position="relative"
        >
            <Box flex={1} minH={0} overflow="hidden" height="100%">
                <Editor
                    height={editorHeight}
                    defaultLanguage="shell"
                    value={value}
                    onChange={(value) => onChange(value || '')}
                    theme={isDark ? 'vs-dark' : 'light'}
                    onMount={(editor, monaco) => {
                        if (onMount) {
                            onMount(editor);
                        }
                        const model = editor.getModel();
                        if (model) {
                            model.setEOL(monaco.editor.EndOfLineSequence.LF);
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
        </Box>
    );
};