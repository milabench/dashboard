/*
    This component is used to display or create a new profile from the Weight table.

*/

import React, { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    Button,
    VStack,
    HStack,
    Heading,
    Select,
    Input,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Switch,
    FormControl,
    FormLabel,
    useToast,
} from '@chakra-ui/react';
import type { Weight } from '../../services/types';
import { getProfileList, getProfileDetails, saveProfile, copyProfile } from '../../services/api';
import Cookies from 'js-cookie';

export const Profile: React.FC = () => {
    usePageTitle('Profiles');

    const [profiles, setProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [scoreProfile, setScoreProfile] = useState<string>('');
    const [weights, setWeights] = useState<Weight[]>([]);
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [sourceProfile, setSourceProfile] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const toast = useToast();

    // Fetch available profiles
    useEffect(() => {
        const fetchProfiles = async () => {
            try {
                const data = await getProfileList();
                setProfiles(data);
                if (data.length > 0) {
                    // Set initial score profile from cookie or default to first profile
                    const savedScoreProfile = Cookies.get('scoreProfile');
                    const initialProfile = savedScoreProfile || data[0];
                    setScoreProfile(initialProfile);
                    setSelectedProfile(initialProfile);
                    setSourceProfile(data[0]);
                }
            } catch (error) {
                console.error('Error fetching profiles:', error);
                toast({
                    title: 'Error fetching profiles',
                    description: error instanceof Error ? error.message : 'Unknown error',
                    status: 'error',
                    duration: 5000,
                });
            }
        };
        fetchProfiles();
    }, []);

    // Fetch weights for selected profile
    useEffect(() => {
        const fetchWeights = async () => {
            if (selectedProfile) {
                try {
                    const data = await getProfileDetails(selectedProfile);
                    setWeights(data);
                } catch (error) {
                    toast({
                        title: 'Error fetching weights',
                        description: error instanceof Error ? error.message : 'Unknown error',
                        status: 'error',
                        duration: 5000,
                    });
                }
            }
        };
        fetchWeights();
    }, [selectedProfile]);

    const handleProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedProfile(event.target.value);
    };

    const handleWeightChange = (id: number, field: keyof Weight, value: any) => {
        setWeights(weights.map(weight =>
            weight._id === id ? { ...weight, [field]: value } : weight
        ));
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            await saveProfile(selectedProfile, weights);
            // Refresh the weights after saving
            const data = await getProfileDetails(selectedProfile);
            setWeights(data);
            toast({
                title: 'Success',
                description: 'Profile saved successfully',
                status: 'success',
                duration: 3000,
            });
        } catch (error) {
            toast({
                title: 'Error saving profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                status: 'error',
                duration: 5000,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyProfile = async () => {
        if (!sourceProfile || !newProfileName) return;

        try {
            setIsCopying(true);
            await copyProfile({
                sourceProfile,
                newProfile: newProfileName,
            });

            // Refresh profiles list
            const data = await getProfileList();
            setProfiles(data);

            // Clear form
            setSourceProfile('');
            setNewProfileName('');

            // Select the new profile
            setSelectedProfile(newProfileName);

            toast({
                title: 'Success',
                description: 'Profile copied successfully',
                status: 'success',
                duration: 3000,
            });
        } catch (error) {
            toast({
                title: 'Error copying profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                status: 'error',
                duration: 5000,
            });
        } finally {
            setIsCopying(false);
        }
    };

    const handleScoreProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setScoreProfile(event.target.value);
    };

    const handleSetScoreProfile = () => {
        Cookies.set('scoreProfile', scoreProfile, { expires: 365 }); // Cookie expires in 1 year
        toast({
            title: 'Success',
            description: `Score computation profile set to ${scoreProfile}`,
            status: 'success',
            duration: 3000,
        });
    };

    return (
        <Box p={4}>
            <VStack align="stretch" spacing={6}>
                <Heading>Profile Management</Heading>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <Heading size="md">Profile Selection</Heading>
                        <HStack spacing={4}>
                            <FormControl>
                                <Select
                                    value={scoreProfile}
                                    onChange={handleScoreProfileChange}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </FormControl>
                            <Button
                                onClick={handleSetScoreProfile}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                Set Score Profile
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <Heading size="md">Copy Profile</Heading>
                        <HStack spacing={4}>
                            <FormControl>
                                <FormLabel>Source Profile</FormLabel>
                                <Select
                                    value={sourceProfile}
                                    onChange={(e) => setSourceProfile(e.target.value)}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl>
                                <FormLabel>New Profile Name</FormLabel>
                                <Input
                                    value={newProfileName}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewProfileName(e.target.value)}
                                />
                            </FormControl>
                            <Button
                                onClick={handleCopyProfile}
                                isLoading={isCopying}
                                isDisabled={!sourceProfile || !newProfileName}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                {isCopying ? 'Copying...' : 'Copy Profile'}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <Heading size="md">Update Profile</Heading>
                        <HStack spacing={4}>
                            <FormControl>
                                <Select
                                    value={selectedProfile}
                                    onChange={handleProfileChange}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </FormControl>

                            <Button
                                onClick={handleSave}
                                isLoading={isSaving}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </HStack>

                        <Table variant="simple">
                            <Thead>
                                <Tr>
                                    <Th>Pack</Th>
                                    <Th>Weight</Th>
                                    <Th>Order</Th>
                                    <Th>Enabled</Th>
                                    <Th>Group 1</Th>
                                    <Th>Group 2</Th>
                                    <Th>Group 3</Th>
                                    <Th>Group 4</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {weights.map((weight) => (
                                    <Tr key={weight._id}>
                                        <Td>{weight.pack}</Td>
                                        <Td>
                                            <Input
                                                type="number"
                                                value={weight.weight}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'weight', parseInt(e.target.value))}
                                                size="sm"
                                            />
                                        </Td>
                                        <Td>
                                            <Input
                                                type="number"
                                                value={weight.priority}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'priority', parseInt(e.target.value))}
                                                size="sm"
                                            />
                                        </Td>
                                        <Td>
                                            <Switch
                                                isChecked={weight.enabled}
                                                onChange={(e) => handleWeightChange(weight._id, 'enabled', e.target.checked)}
                                            />
                                        </Td>
                                        <Td>
                                            <Input
                                                value={weight.group1 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group1', e.target.value)}
                                                size="sm"
                                            />
                                        </Td>
                                        <Td>
                                            <Input
                                                value={weight.group2 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group2', e.target.value)}
                                                size="sm"
                                            />
                                        </Td>
                                        <Td>
                                            <Input
                                                value={weight.group3 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group3', e.target.value)}
                                                size="sm"
                                            />
                                        </Td>
                                        <Td>
                                            <Input
                                                value={weight.group4 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group4', e.target.value)}
                                                size="sm"
                                            />
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </VStack>
                </Box>
            </VStack>
        </Box>
    );
};