import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Input,
    VStack,
    Text,
    Spinner
} from '@chakra-ui/react';

interface AutocompleteInputProps {
    value: string;
    onChange: (value: string) => void;
    suggestions: string[];
    placeholder?: string;
    disabled?: boolean;
    size?: 'sm' | 'md' | 'lg';
    width?: string;
    isLoading?: boolean;
    onSelect?: (value: string) => void;
    renderSuggestion?: (suggestion: string) => React.ReactNode;
}

const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
    value,
    onChange,
    suggestions = [],
    placeholder = "Enter value...",
    disabled = false,
    size = 'md',
    width = 'auto',
    isLoading = false,
    onSelect,
    renderSuggestion
}) => {
    const [inputValue, setInputValue] = useState(value);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
                setSelectedIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Update input value when prop changes
    useEffect(() => {
        setInputValue(value);
    }, [value]);

    // Calculate similarity score between input and suggestion
    const calculateSimilarity = (input: string, suggestion: string): number => {
        const inputLower = input.toLowerCase().trim();
        const suggestionLower = suggestion.toLowerCase();

        if (!inputLower) return 0;
        if (suggestionLower === inputLower) return 1000; // Exact match gets highest score
        if (suggestionLower.startsWith(inputLower)) return 900; // Starts with gets very high score
        if (suggestionLower.includes(inputLower)) return 800; // Contains gets high score

        // Calculate fuzzy similarity for partial matches
        let similarity = 0;
        let inputIndex = 0;

        for (let i = 0; i < suggestionLower.length && inputIndex < inputLower.length; i++) {
            if (suggestionLower[i] === inputLower[inputIndex]) {
                similarity += 10;
                inputIndex++;
            }
        }

        // Bonus for matching more characters
        similarity += (inputIndex / inputLower.length) * 100;

        // Penalty for length difference
        const lengthDiff = Math.abs(suggestionLower.length - inputLower.length);
        similarity -= lengthDiff * 2;

        return Math.max(0, similarity);
    };

    // Sort suggestions by similarity to input
    useEffect(() => {
        if (!inputValue.trim()) {
            setFilteredSuggestions(suggestions);
        } else {
            const scoredSuggestions = suggestions
                .map(suggestion => ({
                    suggestion,
                    score: calculateSimilarity(inputValue, suggestion)
                }))
                .filter(item => item.score > 0) // Only include items with some similarity
                .sort((a, b) => b.score - a.score) // Sort by score descending
                .map(item => item.suggestion);

            setFilteredSuggestions(scoredSuggestions);
        }
        setSelectedIndex(-1);
    }, [inputValue, suggestions]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);
        setShowSuggestions(true);
        setSelectedIndex(-1);
    };

    const handleInputFocus = () => {
        setShowSuggestions(true);
    };

    const handleSuggestionSelect = (suggestion: string) => {
        setInputValue(suggestion);
        onChange(suggestion);
        setShowSuggestions(false);
        setSelectedIndex(-1);
        if (onSelect) {
            onSelect(suggestion);
        }
    };

    const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        // Small delay to allow suggestion clicks to register
        setTimeout(() => {
            if (!dropdownRef.current?.contains(document.activeElement)) {
                setShowSuggestions(false);
                setSelectedIndex(-1);
            }
        }, 200);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showSuggestions) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < filteredSuggestions.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
                    handleSuggestionSelect(filteredSuggestions[selectedIndex]);
                } else {
                    setShowSuggestions(false);
                    setSelectedIndex(-1);
                }
                break;
            case 'Escape':
                setShowSuggestions(false);
                setSelectedIndex(-1);
                break;
        }
    };

    const inputSize = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md';

    return (
        <Box position="relative" width={width} ref={dropdownRef}>
            <Input
                value={inputValue}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                size={inputSize}
                bg="white"
                borderColor="gray.200"
                _hover={{ borderColor: "gray.300" }}
                _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
            />

            {showSuggestions && !disabled && (
                <Box
                    position="absolute"
                    top="100%"
                    left={0}
                    right={0}
                    bg="white"
                    border="1px solid"
                    borderColor="gray.200"
                    borderRadius="md"
                    boxShadow="md"
                    zIndex={1000}
                    maxHeight="200px"
                    overflowY="auto"
                >
                    {isLoading ? (
                        <Box p={2} textAlign="center">
                            <Spinner size="sm" />
                        </Box>
                    ) : filteredSuggestions.length > 0 ? (
                        <VStack gap={0} align="stretch">
                            {filteredSuggestions.map((suggestion, index) => (
                                <Box
                                    key={index}
                                    px={3}
                                    py={2}
                                    cursor="pointer"
                                    bg={selectedIndex === index ? "blue.50" : "transparent"}
                                    borderLeft={selectedIndex === index ? "3px solid" : "3px solid transparent"}
                                    borderColor={selectedIndex === index ? "blue.500" : "transparent"}
                                    _hover={{ bg: selectedIndex === index ? "blue.100" : "gray.100" }}
                                    onMouseDown={(e) => {
                                        e.preventDefault(); // Prevent input blur
                                        handleSuggestionSelect(suggestion);
                                    }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    fontSize={inputSize === 'sm' ? 'sm' : 'md'}
                                >
                                    {renderSuggestion ? renderSuggestion(suggestion) : suggestion}
                                </Box>
                            ))}
                        </VStack>
                    ) : (
                        <Box p={2} color="gray.500" fontSize="sm" textAlign="center">
                            No suggestions found
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default AutocompleteInput;