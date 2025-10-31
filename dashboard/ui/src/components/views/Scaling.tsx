import React, { useState } from 'react';
import {
    Box,
    HStack,
    Select,
    FormControl,
    FormLabel,
} from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';

const Scaling = () => {
    usePageTitle('Scaling');

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
        <Box p={4} height="100vh" display="flex" flexDirection="column" className='scaling-container'>
            <HStack spacing={4} mb={4} width="100%">
                <FormControl flex="1">
                    <FormLabel>X Axis</FormLabel>
                    <Select value={xAxis} onChange={handleXAxisChange}>
                        <option value="batch_size">batch_size</option>
                        <option value="memory">memory</option>
                        <option value="gpu">gpu</option>
                        <option value="cpu">cpu</option>
                        <option value="perf">perf</option>
                        {/* <option value="bench">bench</option>
                        <option value="time">time</option> */}
                    </Select>
                </FormControl>

                <FormControl flex="1">
                    <FormLabel>Y Axis</FormLabel>
                    <Select value={yAxis} onChange={handleYAxisChange}>
                        <option value="batch_size">batch_size</option>
                        <option value="memory">memory</option>
                        <option value="gpu">gpu</option>
                        <option value="cpu">cpu</option>
                        <option value="perf">perf</option>
                    </Select>
                </FormControl>
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
