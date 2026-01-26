/*
    This component is used to display or create a new profile from the Weight table.

*/

import React, { useState, useEffect, useMemo } from 'react';
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
    Switch,
    Field,
    useListCollection,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import type { Weight } from '../../services/types';
import { getProfileList, getProfileDetails, saveProfile, copyProfile } from '../../services/api';
import Cookies from 'js-cookie';

export const Profile: React.FC = () => {
    usePageTitle('Profiles');

    // Theme-aware colors - all hooks must be called at the top level
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const buttonHoverBg = useColorModeValue('gray.100', 'gray.700');
    const focusBorderColor = useColorModeValue('blue.500', 'blue.400');
    const blueButtonBg = useColorModeValue('blue.500', 'blue.600');
    const blueButtonHoverBg = useColorModeValue('blue.600', 'blue.500');
    const inputBg = useColorModeValue('white', 'gray.800');
    const selectBg = useColorModeValue('white', 'gray.800');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.700');
    const headerBg = useColorModeValue('gray.100', 'gray.800');
    const headerTextColor = useColorModeValue('gray.900', 'gray.100');

    const [profiles, setProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [scoreProfile, setScoreProfile] = useState<string>('');
    const [weights, setWeights] = useState<Weight[]>([]);
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [sourceProfile, setSourceProfile] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);

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
                toaster.create({
                    title: 'Error fetching profiles',
                    description: error instanceof Error ? error.message : 'Unknown error',
                    type: 'error',
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
                    toaster.create({
                        title: 'Error fetching weights',
                        description: error instanceof Error ? error.message : 'Unknown error',
                        type: 'error',
                        duration: 5000,
                    });
                }
            }
        };
        fetchWeights();
    }, [selectedProfile]);

    const handleProfileChange = (details: { value: string[] }) => {
        setSelectedProfile(details.value[0] || '');
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
            toaster.create({
                title: 'Success',
                description: 'Profile saved successfully',
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Error saving profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
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

            toaster.create({
                title: 'Success',
                description: 'Profile copied successfully',
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Error copying profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsCopying(false);
        }
    };

    const handleScoreProfileChange = (details: { value: string[] }) => {
        setScoreProfile(details.value[0] || '');
    };

    const handleSetScoreProfile = () => {
        Cookies.set('scoreProfile', scoreProfile, { expires: 365 }); // Cookie expires in 1 year
        toaster.create({
            title: 'Success',
            description: `Score computation profile set to ${scoreProfile}`,
            type: 'success',
            duration: 3000,
        });
    };

    // Collections for Select components
    const profileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const profileCollection = useListCollection({ initialItems: profileItems });

    const scoreProfileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const scoreProfileCollection = useListCollection({ initialItems: scoreProfileItems });

    const sourceProfileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const sourceProfileCollection = useListCollection({ initialItems: sourceProfileItems });

    return (
        <Box p={4} bg={pageBg}>
            <VStack align="stretch" gap={6}>
                <Heading color={textColor}>Profile Management</Heading>

                <Box borderWidth={1} borderRadius="md" p={4} bg={cardBg} borderColor={borderColor}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color={textColor}>Profile Selection</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color={textColor}>Score Profile</Field.Label>
                                <Select.Root
                                    collection={scoreProfileCollection.collection}
                                    value={scoreProfile ? [scoreProfile] : []}
                                    onValueChange={handleScoreProfileChange}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select score profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {scoreProfileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>
                            <Button
                                onClick={handleSetScoreProfile}
                                bg={blueButtonBg}
                                color="white"
                                alignSelf="flex-end"
                                _hover={{ bg: blueButtonHoverBg }}
                            >
                                Set Score Profile
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4} bg={cardBg} borderColor={borderColor}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color={textColor}>Copy Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color={textColor}>Source Profile</Field.Label>
                                <Select.Root
                                    collection={sourceProfileCollection.collection}
                                    value={sourceProfile ? [sourceProfile] : []}
                                    onValueChange={(details) => setSourceProfile(details.value[0] || '')}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select source profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {sourceProfileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>
                            <Field.Root>
                                <Field.Label color={textColor}>New Profile Name</Field.Label>
                                <Input
                                    value={newProfileName}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewProfileName(e.target.value)}
                                    bg={inputBg}
                                    borderColor={borderColor}
                                    color={textColor}
                                    _focus={{ borderColor: focusBorderColor }}
                                />
                            </Field.Root>
                            <Button
                                onClick={handleCopyProfile}
                                disabled={!sourceProfile || !newProfileName}
                                bg={blueButtonBg}
                                color="white"
                                alignSelf="flex-end"
                                _hover={{ bg: blueButtonHoverBg }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                {isCopying ? 'Copying...' : 'Copy Profile'}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4} bg={cardBg} borderColor={borderColor}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color={textColor}>Update Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color={textColor}>Profile</Field.Label>
                                <Select.Root
                                    collection={profileCollection.collection}
                                    value={selectedProfile ? [selectedProfile] : []}
                                    onValueChange={handleProfileChange}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {profileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>

                            <Button
                                onClick={handleSave}
                                bg={blueButtonBg}
                                color="white"
                                alignSelf="flex-end"
                                _hover={{ bg: blueButtonHoverBg }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </HStack>

                        <Table.Root>
                            <Table.Header bg={headerBg}>
                                <Table.Row>
                                    <Table.ColumnHeader color={headerTextColor}>Pack</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Weight</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Order</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Enabled</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Group 1</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Group 2</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Group 3</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Group 4</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {weights.map((weight) => (
                                    <Table.Row
                                        key={weight._id}
                                        _hover={{ bg: rowHoverBg }}
                                        borderColor={borderColor}
                                    >
                                        <Table.Cell color={textColor}>{weight.pack}</Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.weight}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'weight', parseInt(e.target.value))}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.priority}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'priority', parseInt(e.target.value))}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Switch.Root
                                                checked={weight.enabled}
                                                onCheckedChange={(details) => handleWeightChange(weight._id, 'enabled', details.checked)}
                                            >
                                                <Switch.HiddenInput />
                                                <Switch.Control>
                                                    <Switch.Thumb />
                                                </Switch.Control>
                                            </Switch.Root>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group1 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group1', e.target.value)}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group2 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group2', e.target.value)}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group3 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group3', e.target.value)}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group4 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group4', e.target.value)}
                                                size="sm"
                                                bg={inputBg}
                                                borderColor={borderColor}
                                                color={textColor}
                                                _focus={{ borderColor: focusBorderColor }}
                                            />
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    </VStack>
                </Box>
            </VStack>
        </Box>
    );
};