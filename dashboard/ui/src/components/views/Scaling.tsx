import React, { useState } from 'react';
import {
    Box,
    HStack,
    NativeSelect,
    Field,
} from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useColorModeValue } from '../ui/color-mode';

const Scaling = () => {
    usePageTitle('Scaling');

    // Theme-aware colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const labelColor = useColorModeValue('gray.700', 'gray.300');
    const selectBg = useColorModeValue('white', 'gray.800');
    const selectBorderColor = useColorModeValue('gray.200', 'gray.700');
    const selectFocusBorderColor = useColorModeValue('blue.500', 'blue.400');

    const [searchParams, setSearchParams] = useState({ x: 'memory', y: 'perf' });

    const xAxis = searchParams.x;
    const yAxis = searchParams.y;

    const handleXAxisChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSearchParams({ ...searchParams, x: event.target.value });
    };

    const handleYAxisChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSearchParams({ ...searchParams, y: event.target.value });
    };

    return (
        <Box p={4} height="100vh" display="flex" flexDirection="column" className='scaling-container' bg={pageBg}>
            <HStack gap={4} mb={4} width="100%">
                <Field.Root flex="1">
                    <Field.Label color={labelColor}>X Axis</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={xAxis}
                            onChange={handleXAxisChange}
                            bg={selectBg}
                            borderColor={selectBorderColor}
                            color={textColor}
                            _focusVisible={{ borderColor: selectFocusBorderColor }}
                        >
                            <option value="batch_size">batch_size</option>
                            <option value="memory">memory</option>
                            <option value="gpu">gpu</option>
                            <option value="cpu">cpu</option>
                            <option value="perf">perf</option>
                            {/* <option value="bench">bench</option>
                            <option value="time">time</option> */}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="1">
                    <Field.Label color={labelColor}>Y Axis</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={yAxis}
                            onChange={handleYAxisChange}
                            bg={selectBg}
                            borderColor={selectBorderColor}
                            color={textColor}
                            _focusVisible={{ borderColor: selectFocusBorderColor }}
                        >
                            <option value="batch_size">batch_size</option>
                            <option value="memory">memory</option>
                            <option value="gpu">gpu</option>
                            <option value="cpu">cpu</option>
                            <option value="perf">perf</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>
            </HStack>

            <Box flex="1">
                <iframe
                    src={`/html/scaling/x=${xAxis}/y=${yAxis}`}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title="Scaling Plot"
                />
            </Box>
        </Box>
    );
};

export default Scaling;
