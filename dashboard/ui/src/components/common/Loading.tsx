import { Center, Spinner, Text, VStack } from '@chakra-ui/react';

interface LoadingProps {
    message?: string;
}

export const Loading = ({ message = 'Loading...' }: LoadingProps) => {
    return (
        <Center h="100%" w="100%">
            <VStack gap={4}>
                <Spinner
                    size="xl"
                    color="blue.500"
                />
                <Text color="gray.500">{message}</Text>
            </VStack>
        </Center>
    );
};